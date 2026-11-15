// «Сервисы и оплаты»: список подписок (домен, сервер, хранилище, почта) и срок, до которого оплачено.
// Только owner и tech: здесь деньги и ссылки на оплату. Напоминание-плашку рисует админка по этим данным.
import { audit } from '../access.js';

const bad = (reply, status, error) => reply.code(status).send({ error });
const idOf = (v) => (/^\d{1,15}$/.test(String(v)) ? String(v) : null);
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const COLS = `id, name, what, amount_kop, period, to_char(paid_until, 'YYYY-MM-DD') AS paid_until, pay_url, payer, auto_renew, note`;
const MAX_ROWS = 60;

const validDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= '2025-01-01' && s <= '2100-12-31';
};
// Ссылка на страницу оплаты: только https, чтобы в кнопку не попал javascript: и подобное
const validUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' && s.length <= 300; } catch { return false; } };

export const serviceView = (r) => ({
  id: String(r.id), name: r.name, what: r.what, sum: r.amount_kop / 100, period: r.period,
  until: r.paid_until, payUrl: r.pay_url, payer: r.payer, autoRenew: r.auto_renew, note: r.note,
});

// Разбор тела запроса. partial = PATCH: приходят только изменённые поля.
function parse(b, partial) {
  const out = {}, has = (k) => !partial || k in b;
  if (has('name')) { out.name = text(b.name, 80); if (!out.name) return { error: 'Напиши название сервиса.' }; }
  if (has('what')) out.what = text(b.what, 200);
  if (has('sum')) {
    const n = Number(b.sum);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return { error: 'Сумма: целое число рублей, можно 0.' };
    out.amount_kop = n * 100;
  }
  if (has('period')) { if (b.period !== 'month' && b.period !== 'year') return { error: 'Выбери период: месяц или год.' }; out.period = b.period; }
  if (has('until')) {
    const u = b.until == null ? '' : String(b.until).trim();
    if (u && !validDate(u)) return { error: 'Дата: выбери из календаря.' };
    out.paid_until = u || null;
  }
  if (has('payUrl')) {
    const u = text(b.payUrl, 300);
    if (u && !validUrl(u)) return { error: 'Ссылка на оплату должна начинаться с https://' };
    out.pay_url = u;
  }
  if (has('payer')) { if (b.payer !== 'nika' && b.payer !== 'karolina') return { error: 'Выбери, кто платит.' }; out.payer = b.payer; }
  if (has('autoRenew')) { if (typeof b.autoRenew !== 'boolean') return { error: 'Автопродление: да или нет.' }; out.auto_renew = b.autoRenew; }
  if (has('note')) out.note = text(b.note, 300);
  return { out };
}

export default async function servicesRoutes(app, { pool }) {
  const money = async (req, reply) => {
    if (req.admin.role !== 'owner' && req.admin.role !== 'tech') return bad(reply, 403, 'Этот раздел недоступен для твоей роли.');
  };
  const noStore = (reply) => reply.header('cache-control', 'no-store');

  app.get('/api/admin/services', { preHandler: money }, async (req, reply) => {
    noStore(reply);
    const { rows } = await pool.query(`SELECT ${COLS} FROM services ORDER BY paid_until NULLS LAST, id LIMIT ${MAX_ROWS}`);
    return { services: rows.map(serviceView) };
  });

  app.post('/api/admin/services', { preHandler: money }, async (req, reply) => {
    const { out, error } = parse(req.body || {}, false);
    if (error) return bad(reply, 400, error);
    if ((await pool.query('SELECT count(*)::int AS n FROM services')).rows[0].n >= MAX_ROWS) return bad(reply, 400, 'Сервисов уже много. Удали ненужные.');
    const { rows } = await pool.query(
      `INSERT INTO services (name, what, amount_kop, period, paid_until, pay_url, payer, auto_renew, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLS}`,
      [out.name, out.what, out.amount_kop, out.period, out.paid_until, out.pay_url, out.payer, out.auto_renew, out.note]);
    await audit(pool, req.admin.id, 'service.create', { target: `service:${rows[0].id}`, meta: { name: out.name } });
    return reply.code(201).send({ service: serviceView(rows[0]) });
  });

  app.patch('/api/admin/services/:id', { preHandler: money }, async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Сервис не найден');
    const { out, error } = parse(req.body || {}, true);
    if (error) return bad(reply, 400, error);
    const keys = Object.keys(out);
    if (!keys.length) return bad(reply, 400, 'Нечего сохранять.');
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');   // имена колонок только из parse(), не из запроса
    const { rows } = await pool.query(`UPDATE services SET ${sets}, updated_at = now() WHERE id = $1 RETURNING ${COLS}`, [id, ...keys.map((k) => out[k])]);
    if (!rows[0]) return bad(reply, 404, 'Сервис не найден');
    await audit(pool, req.admin.id, 'service.update', { target: `service:${id}`, meta: { name: rows[0].name, until: 'paid_until' in out ? out.paid_until : undefined } });
    return { service: serviceView(rows[0]) };
  });

  app.delete('/api/admin/services/:id', { preHandler: money }, async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Сервис не найден');
    const { rows } = await pool.query('DELETE FROM services WHERE id = $1 RETURNING name', [id]);
    if (!rows[0]) return bad(reply, 404, 'Сервис не найден');
    await audit(pool, req.admin.id, 'service.delete', { meta: { name: rows[0].name } });
    return { ok: true };
  });
}
