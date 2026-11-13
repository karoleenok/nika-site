// Заявки с лендинга и анкета теста по анализам.
// Заявку видят все роли админки. Ответы анкеты (данные о здоровье) — только owner, каждый просмотр в журнале.
// Почту, телефон и ответы анкеты в лог сервера не пишем.
import crypto from 'node:crypto';
import { Limiter } from '../auth/limits.js';
import { audit } from '../access.js';
import { adminLeadMail } from '../mail.js';
import { cleanAnswers, flaggedBlocks, readable, ANALYSES, VERSION, CONSENT_VERSION, HEALTH_CONSENT_VERSION } from './quiz.js';

export const SERVICES = { test: 'тест по анализам', training: 'тренировки', food: 'питание', package: 'полный пакет', other: 'другое' };
const QUIZ_KEY_HOURS = 24;
const MIN_FILL_MS = 2500;        // быстрее человек форму не заполнит
const DUP_MINUTES = 30;          // повторная заявка с тем же номером за это время не создаёт новую
const GLOBAL_PER_HOUR = 200;     // общий потолок на случай наплыва ботов с разных адресов

const bad = (reply, status, error) => reply.code(status).send({ error });
const idOf = (v) => (/^\d{1,15}$/.test(String(v)) ? String(v) : null);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const digits = (v) => String(v ?? '').replace(/\D/g, '');
// Российский номер приводим к +7XXXXXXXXXX; остальные храним как ввели (только цифры и +)
export function normPhone(v) {
  let d = digits(v);
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
  else if (d.length === 10 && d[0] === '9') d = '7' + d;
  if (d.length < 10 || d.length > 15) return null;
  return '+' + d;
}

export default async function leadRoutes(app, { config, pool, mailer }) {
  const ipShort = new Limiter({ max: 5, windowMs: 15 * 60e3 });
  const ipDay = new Limiter({ max: 20, windowMs: 24 * 3600e3 });
  const quizLimit = new Limiter({ max: 10, windowMs: 15 * 60e3 });
  setInterval(() => { ipShort.sweep(); ipDay.sweep(); quizLimit.sweep(); }, 10 * 60e3).unref();
  // Срок из согласия на данные о здоровье: ответы теста храним не дольше года
  const purge = () => pool.query(`DELETE FROM questionnaires WHERE created_at < now() - interval '365 days'`).catch(() => {});
  setInterval(purge, 24 * 3600e3).unref();
  const noStore = (reply) => reply.header('cache-control', 'no-store');

  // ---------- Заявка с лендинга ----------
  app.post('/api/leads', async (req, reply) => {
    noStore(reply);
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (ipShort.blocked(req.ip) || ipDay.blocked(req.ip)) return bad(reply, 429, 'Слишком много заявок. Напиши Нике в WhatsApp.');
    ipShort.hit(req.ip); ipDay.hit(req.ip);
    const service = Object.hasOwn(SERVICES, b.service) ? b.service : null;
    // Ловушка для ботов: скрытое поле заполнено или форма отправлена мгновенно.
    // Отвечаем как обычно, чтобы бот не понял, что его отсеяли, но ничего не сохраняем.
    const ms = Number(b.ms);
    if (b.website || !Number.isFinite(ms) || ms < MIN_FILL_MS) {
      return service === 'test' ? { ok: true, quizKey: crypto.randomBytes(24).toString('base64url') } : { ok: true };
    }
    const name = clean(b.name, 80), phone = normPhone(b.phone);
    if (!name || !phone || !service) return bad(reply, 400, 'Проверь имя и номер телефона.');
    if (b.consent !== true || b.agree !== true) return bad(reply, 400, 'Поставь обе галочки: согласие на обработку данных и ознакомление с документами.');
    const message = clean(b.message, 500);

    const total = (await pool.query(`SELECT count(*)::int AS n FROM leads WHERE created_at > now() - interval '1 hour'`)).rows[0].n;
    if (total >= GLOBAL_PER_HOUR) return bad(reply, 503, 'Сейчас не получается принять заявку. Напиши Нике в WhatsApp.');

    const key = service === 'test' ? crypto.randomBytes(24).toString('base64url') : null;
    const keyCols = key ? [sha(key), new Date(Date.now() + QUIZ_KEY_HOURS * 3600e3)] : [null, null];
    // Повтор с тем же номером и услугой: обновляем существующую заявку, второй не создаём
    const dup = (await pool.query(
      `UPDATE leads SET name = $3, message = CASE WHEN $4 = '' THEN message ELSE $4 END, consent_at = now(), consent_version = $5,
         quiz_key_hash = COALESCE($6, quiz_key_hash), quiz_key_until = COALESCE($7, quiz_key_until)
       WHERE id = (SELECT id FROM leads WHERE contact = $1 AND service = $2 AND done_at IS NULL
                   AND created_at > now() - make_interval(mins => $8) ORDER BY id DESC LIMIT 1)
         AND NOT (service = 'test' AND EXISTS (SELECT 1 FROM questionnaires q WHERE q.lead_id = leads.id))
       RETURNING id`, [phone, service, name, message, CONSENT_VERSION, ...keyCols, DUP_MINUTES])).rows[0];
    if (!dup) {
      await pool.query(
        `INSERT INTO leads (name, contact, service, message, source, consent_at, consent_version, quiz_key_hash, quiz_key_until)
         VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8)`,
        [name, phone, service, message, service === 'test' ? 'test' : 'site', CONSENT_VERSION, ...keyCols]);
      // Нике — без телефона и без ответов: они только в админке
      if (config.smtp.adminNotify) mailer.sendLater({ to: config.smtp.adminNotify, ...adminLeadMail({ name, service: SERVICES[service], adminUrl: `${config.publicUrl}/admin/#/leads` }) });
    }
    return key ? { ok: true, quizKey: key } : { ok: true };
  });

  // ---------- Анкета ----------
  app.post('/api/quiz', async (req, reply) => {
    noStore(reply);
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (quizLimit.blocked(req.ip)) return bad(reply, 429, 'Слишком много попыток. Подожди 15 минут.');
    quizLimit.hit(req.ip);
    if (b.healthConsent !== true) return bad(reply, 400, 'Отметь согласие на обработку данных о здоровье: без него Ника не сможет посмотреть ответы.');
    if (b.version !== VERSION) return bad(reply, 409, 'Вопросы обновились. Обнови страницу и пройди тест ещё раз.');
    const answers = cleanAnswers(b.answers);
    if (!answers) return bad(reply, 400, 'Ответь на все вопросы.');
    const key = typeof b.key === 'string' && b.key.length <= 64 ? b.key : '';
    const blocks = flaggedBlocks(answers);   // какие блоки выделил тест; тексты итога собирает страница
    // Ключ одноразовый: после сохранения стираем, второй раз ту же заявку не заполнить
    const lead = key && (await pool.query(
      `UPDATE leads SET quiz_key_hash = NULL, quiz_key_until = NULL, is_new = true
       WHERE quiz_key_hash = $1 AND quiz_key_until > now() RETURNING id`, [sha(key)])).rows[0];
    // Неверный, старый или ботовый ключ выглядит для человека так же, как верный: ответ тот же, но в базу ничего не попадает
    if (lead) {
      await pool.query(
        `INSERT INTO questionnaires (lead_id, answers, analyses, form_version, consent_at, consent_version)
         VALUES ($1, $2, $3, $4, now(), $5) ON CONFLICT DO NOTHING`,
        [lead.id, answers, JSON.stringify(blocks), VERSION, HEALTH_CONSENT_VERSION]);
    }
    // Промокод отдаём только при настоящем ключе заявки и только если Ника его задала (QUIZ_PROMO_CODE в .env)
    const { promoCode, promoPercent } = config.quiz;
    return lead && promoCode && promoPercent ? { ok: true, promo: { code: promoCode, percent: promoPercent } } : { ok: true };
  });

  // ---------- Админка ----------
  const owner = async (req, reply) => {
    if (req.admin.role !== 'owner') return bad(reply, 403, 'Ответы анкеты видит только Ника.');
  };

  app.get('/api/admin/leads', async (req, reply) => {
    noStore(reply);
    const { rows } = await pool.query(
      `SELECT l.id, l.name, l.contact, l.service, l.source, l.message, l.is_new, l.created_at, l.done_at,
              (q.id IS NOT NULL) AS has_quiz
       FROM leads l LEFT JOIN questionnaires q ON q.lead_id = l.id
       ORDER BY l.is_new DESC, l.created_at DESC LIMIT 300`);
    return {
      canQuiz: req.admin.role === 'owner',
      leads: rows.map((r) => ({
        id: String(r.id), name: r.name, phone: r.contact, service: SERVICES[r.service] ?? r.service, serviceId: r.service,
        source: r.source, message: r.message, isNew: r.is_new, createdAt: r.created_at, doneAt: r.done_at,
        quiz: r.has_quiz ? 'done' : r.source === 'test' ? 'waiting' : null,
      })),
    };
  });

  app.get('/api/admin/leads/:id/quiz', { preHandler: owner }, async (req, reply) => {
    noStore(reply);
    const id = idOf(req.params.id);
    const q = id && (await pool.query(
      'SELECT answers, analyses, form_version, consent_at, consent_version, created_at FROM questionnaires WHERE lead_id = $1', [id])).rows[0];
    if (!q) return bad(reply, 404, 'Анкеты нет');
    await audit(pool, req.admin.id, 'lead.quiz_view', { target: id });
    return {
      answers: readable(q.answers), analyses: q.analyses.map((k) => ANALYSES[k] ?? k),
      formVersion: q.form_version, consentAt: q.consent_at, consentVersion: q.consent_version, createdAt: q.created_at,
    };
  });

  app.post('/api/admin/leads/:id/done', async (req, reply) => {
    noStore(reply);
    const id = idOf(req.params.id), done = req.body?.done !== false;
    const r = id && (await pool.query(
      `UPDATE leads SET is_new = $2, done_at = CASE WHEN $2 THEN NULL ELSE now() END, done_by = CASE WHEN $2 THEN NULL ELSE $3::bigint END
       WHERE id = $1 RETURNING id`, [id, !done, req.admin.id])).rows[0];
    if (!r) return bad(reply, 404, 'Заявка не найдена');
    await audit(pool, req.admin.id, done ? 'lead.done' : 'lead.reopen', { target: id });
    return { ok: true };
  });

  // Удаление по просьбе человека (отзыв согласия, 152-ФЗ). Вместе с заявкой удаляется анкета.
  app.delete('/api/admin/leads/:id', async (req, reply) => {
    noStore(reply);
    if (!['owner', 'tech'].includes(req.admin.role)) return bad(reply, 403, 'Удалять заявки может только Ника.');
    const id = idOf(req.params.id);
    const r = id && (await pool.query('DELETE FROM leads WHERE id = $1 RETURNING id', [id])).rows[0];
    if (!r) return bad(reply, 404, 'Заявка не найдена');
    await audit(pool, req.admin.id, 'lead.delete', { target: id });
    return { ok: true };
  });
}
