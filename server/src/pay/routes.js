// Оплата. Доступ открывает только уведомление Robokassa (ResultURL) с верной подписью.
// SuccessURL и FailURL — обычные страницы сайта, они лишь спрашивают статус заказа.
import crypto from 'node:crypto';
import { tx } from '../db.js';
import { normEmail, validEmail } from '../auth/crypto.js';
import { Limiter } from '../auth/limits.js';
import { audit, DAY } from '../access.js';
import { paidMail, adminPaidMail } from '../mail.js';
import { paymentUrl, resultSignOk, sumToKop, MAX_INV_ID } from './robokassa.js';

export const OFFER_VERSION = '2026-11-13';
const bad = (reply, status, error) => reply.code(status).send({ error });
const idOf = (v) => (/^\d{1,10}$/.test(String(v)) ? String(v) : null);
const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);

// Выдать то, за что заплатили. Вызывается внутри транзакции, заказ уже заблокирован (FOR UPDATE).
// Повторный вызов для того же заказа ничего не добавит: access_periods.order_id и purchases.order_id уникальны.
export async function fulfill(c, order) {
  let uid = order.user_id;
  if (!uid) {
    const u = await c.query(
      `INSERT INTO users (email, name) VALUES ($1, '') ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`, [order.email]);
    uid = u.rows[0].id;
    await c.query('UPDATE orders SET user_id = $2 WHERE id = $1', [order.id, uid]);
  }
  await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [uid]);   // как в ручном продлении: без гонок
  let endsAt = null;
  if (order.kind === 'access') {
    const active = (await c.query(
      'SELECT max(ends_at) AS e FROM access_periods WHERE user_id = $1 AND closed_at IS NULL AND ends_at > now()', [uid])).rows[0].e;
    const base = active ? new Date(active) : new Date();
    const ends = new Date(base.getTime() + order.access_days * DAY);
    const r = await c.query(
      `INSERT INTO access_periods (user_id, tariff_id, order_id, starts_at, ends_at, source) VALUES ($1, $2, $3, $4, $5, 'payment')
       ON CONFLICT (order_id) DO NOTHING RETURNING ends_at`, [uid, order.tariff_id, order.id, base, ends]);
    endsAt = r.rows[0]?.ends_at ?? ends;
  } else if (order.kind === 'material') {
    await c.query(`INSERT INTO purchases (user_id, tariff_id, order_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [uid, order.tariff_id, order.id]);
  }
  return { userId: uid, endsAt };
}

const ORDER_FOR_UPDATE = `SELECT o.*, t.kind, t.access_days FROM orders o JOIN tariffs t ON t.id = o.tariff_id WHERE o.id = $1 FOR UPDATE OF o`;

export default async function payRoutes(app, { config, pool, mailer }) {
  const rk = config.robokassa;
  const startLimit = new Limiter({ max: 10, windowMs: 15 * 60e3 });
  const statusLimit = new Limiter({ max: 120, windowMs: 15 * 60e3 });
  setInterval(() => { startLimit.sweep(); statusLimit.sweep(); }, 10 * 60e3).unref();

  const notify = (order, endsAt) => {
    mailer.sendLater({ to: order.email, ...paidMail({ title: order.item_name, kop: order.amount_kop, kind: order.kind, endsAt, lkUrl: `${config.publicUrl}/lk/login.html` }) });
    if (config.smtp.adminNotify) mailer.sendLater({ to: config.smtp.adminNotify, ...adminPaidMail({
      title: order.item_name, kop: order.amount_kop, email: order.email, kind: order.kind, endsAt, test: order.test, adminUrl: `${config.publicUrl}/admin/#/payments` }) });
  };

  // ---------- Создать заказ и получить ссылку на оплату ----------
  app.post('/api/pay/start', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (!rk.login || !rk.password1 || !rk.password2) return bad(reply, 503, 'Оплата временно недоступна. Напиши Нике, она поможет.');
    if (startLimit.blocked(req.ip)) return bad(reply, 429, 'Слишком много попыток. Подожди 15 минут.');
    startLimit.hit(req.ip);
    const email = normEmail(req.body?.email), slug = String(req.body?.item ?? '');
    if (!validEmail(email)) return bad(reply, 400, 'Проверь почту: так мы пришлём чек.');
    if (req.body?.consent !== true || req.body?.agree !== true) return bad(reply, 400, 'Поставь обе галочки: согласие и ознакомление с документами.');
    // Цену и название берём только из базы: из браузера приходит лишь артикул
    const t = (await pool.query('SELECT id, kind, name, price_kop FROM tariffs WHERE slug = $1 AND active', [slug])).rows[0];
    if (!t || t.price_kop <= 0) return bad(reply, 404, 'Такого товара нет. Вернись в магазин и выбери заново.');
    const key = crypto.randomBytes(18).toString('base64url');
    const user = (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
    const o = (await pool.query(
      `INSERT INTO orders (user_id, email, tariff_id, item_name, amount_kop, status_key, consent_at, offer_version, test)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8) RETURNING id`,
      [user?.id ?? null, email, t.id, t.name, t.price_kop, key, OFFER_VERSION, rk.test])).rows[0];
    if (Number(o.id) > MAX_INV_ID) throw new Error('InvId вышел за предел Robokassa');
    const url = paymentUrl(rk, { invId: o.id, kop: t.price_kop, description: t.name, name: t.name, email });
    return { orderId: String(o.id), key, url };
  });

  // ---------- Статус заказа для страницы «спасибо» ----------
  app.get('/api/pay/status/:id', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (statusLimit.blocked(req.ip)) return bad(reply, 429, 'Слишком часто. Подожди немного.');
    statusLimit.hit(req.ip);
    const id = idOf(req.params.id), key = String(req.query?.k ?? '');
    const o = id && (await pool.query(
      `SELECT o.status, o.status_key, o.item_name, t.kind, t.slug FROM orders o JOIN tariffs t ON t.id = o.tariff_id WHERE o.id = $1`, [id])).rows[0];
    // Чужой заказ и несуществующий выглядят одинаково
    if (!o || !o.status_key || !crypto.timingSafeEqual(Buffer.from(o.status_key.padEnd(64)), Buffer.from(key.slice(0, 64).padEnd(64)))) return bad(reply, 404, 'Заказ не найден');
    const status = o.status === 'manual' ? 'paid' : o.status;
    return { status, title: o.item_name, kind: o.kind, item: o.slug };
  });

  // ---------- Уведомление Robokassa ----------
  // Приходит формой (application/x-www-form-urlencoded) POST или GET, без Origin. Разбор формы только в этом маршруте.
  await app.register(async (sub) => {
    sub.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8192 },
      (req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));
    const handler = async (req, reply) => {
      reply.header('cache-control', 'no-store').type('text/plain; charset=utf-8');
      const p = { ...(req.query || {}), ...(typeof req.body === 'object' && req.body ? req.body : {}) };
      const inv = String(p.InvId ?? '').slice(0, 20), sum = String(p.OutSum ?? '').slice(0, 30);
      const log = (orderId, result) => pool.query('INSERT INTO payment_events (order_id, inv_id, out_sum, result, ip) VALUES ($1, $2, $3, $4, $5)',
        [orderId, inv, sum, result, req.ip]).catch(() => {});
      if (!resultSignOk(rk, p)) { await log(null, 'bad_sign'); return reply.code(400).send('bad sign'); }
      const id = idOf(inv);
      const out = await tx(pool, async (c) => {
        const o = id && (await c.query(ORDER_FOR_UPDATE, [id])).rows[0];
        if (!o) return { result: 'bad_order' };
        if (sumToKop(sum) !== o.amount_kop) return { result: 'bad_sum', o };
        if (o.status === 'paid' || o.status === 'manual') return { result: 'repeat', o };   // повтор: ответить OK, ничего не делать
        if (o.status !== 'new' && o.status !== 'failed') return { result: 'bad_status', o };
        const g = await fulfill(c, o);
        const fee = sumToKop(p.Fee);
        await c.query(`UPDATE orders SET status = 'paid', paid_at = now(), pay_method = $2, fee_kop = $3 WHERE id = $1`,
          [o.id, cleanText(p.IncCurrLabel || p.PaymentMethod, 40) || null, fee]);
        await audit(c, null, 'order.paid', { userId: g.userId, target: String(o.id),
          meta: { title: o.item_name, sumKop: o.amount_kop, endsAt: g.endsAt && new Date(g.endsAt).toISOString(), test: o.test } });
        return { result: 'paid', o, endsAt: g.endsAt };
      });
      await log(out.o?.id ?? null, out.result);
      if (out.result === 'paid') notify(out.o, out.endsAt);
      if (out.result === 'paid' || out.result === 'repeat') return `OK${inv}`;
      // Сумма не та или заказ не найден: подпись верна, значит ошибка в настройках. Пишем в лог сервера (без почты).
      req.log.warn({ inv, result: out.result }, 'robokassa result rejected');
      return reply.code(400).send('bad order');
    };
    sub.post('/api/pay/result', handler);
    sub.get('/api/pay/result', handler);
  });

  // ---------- Админка: заказы, ручное подтверждение, возврат ----------
  const money = async (req, reply) => {
    if (!['owner', 'tech'].includes(req.admin.role)) return bad(reply, 403, 'Этот раздел недоступен для твоей роли.');
  };

  app.get('/api/admin/orders', { preHandler: money }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const { rows } = await pool.query(
      `SELECT o.id, o.email, o.user_id, o.item_name, o.amount_kop, o.status, o.paid_at, o.created_at, o.refunded_at,
              o.status_note, o.test, o.pay_method, a.name AS who
         FROM orders o LEFT JOIN admins a ON a.id = o.status_by
        WHERE o.status <> 'new' OR o.created_at > now() - interval '14 days'
        ORDER BY o.id DESC LIMIT 200`);
    return { orders: rows.map((o) => ({
      id: String(o.id), email: o.email, clientId: o.user_id ? String(o.user_id) : null, title: o.item_name, sumKop: o.amount_kop,
      status: o.status, at: o.paid_at || o.created_at, createdAt: o.created_at, refundedAt: o.refunded_at,
      note: o.status_note, who: o.who, test: o.test, method: o.pay_method })) };
  });

  // Деньги пришли, а уведомление нет (сбой связи): Ника видит оплату в кабинете Robokassa и подтверждает сама
  app.post('/api/admin/orders/:id/confirm', { preHandler: money }, async (req, reply) => {
    const id = idOf(req.params.id), note = cleanText(req.body?.note, 200);
    if (!id) return bad(reply, 404, 'Заказ не найден');
    if (note.length < 3) return bad(reply, 400, 'Напиши, почему отмечаешь вручную. Например: «оплата есть в кабинете Robokassa».');
    const out = await tx(pool, async (c) => {
      const o = (await c.query(ORDER_FOR_UPDATE, [id])).rows[0];
      if (!o) return { err: [404, 'Заказ не найден'] };
      if (o.status !== 'new' && o.status !== 'failed') return { err: [400, 'Этот заказ уже оплачен или возвращён.'] };
      const g = await fulfill(c, o);
      await c.query(`UPDATE orders SET status = 'manual', paid_at = now(), status_note = $2, status_by = $3 WHERE id = $1`, [id, note, req.admin.id]);
      await audit(c, req.admin.id, 'order.manual', { userId: g.userId, target: id, note,
        meta: { title: o.item_name, sumKop: o.amount_kop, endsAt: g.endsAt && new Date(g.endsAt).toISOString() } });
      return { o, endsAt: g.endsAt };
    });
    if (out.err) return bad(reply, ...out.err);
    notify(out.o, out.endsAt);
    return { ok: true };
  });

  // Возврат: деньги возвращаются в кабинете Robokassa, здесь отмечаем и закрываем то, что было куплено
  app.post('/api/admin/orders/:id/refund', { preHandler: money }, async (req, reply) => {
    const id = idOf(req.params.id), note = cleanText(req.body?.note, 200);
    if (!id) return bad(reply, 404, 'Заказ не найден');
    if (note.length < 3) return bad(reply, 400, 'Напиши причину возврата.');
    const out = await tx(pool, async (c) => {
      const o = (await c.query(ORDER_FOR_UPDATE, [id])).rows[0];
      if (!o) return { err: [404, 'Заказ не найден'] };
      if (o.status !== 'paid' && o.status !== 'manual') return { err: [400, 'Вернуть можно только оплаченный заказ.'] };
      // Закрываем доступ этого заказа. Если после него были продления, они сдвигаются назад на срок этого заказа.
      const p = (await c.query('SELECT id, starts_at, ends_at FROM access_periods WHERE order_id = $1', [id])).rows[0];
      if (p) {
        const len = new Date(p.ends_at) - new Date(p.starts_at);
        await c.query(`UPDATE access_periods SET closed_at = now(), close_note = $2 WHERE id = $1 AND closed_at IS NULL`, [p.id, 'возврат: ' + note]);
        await c.query(`UPDATE access_periods SET starts_at = starts_at - make_interval(secs => $3), ends_at = ends_at - make_interval(secs => $3)
                        WHERE user_id = $1 AND id <> $2 AND closed_at IS NULL AND starts_at >= $4`, [o.user_id, p.id, len / 1000, p.ends_at]);
      }
      await c.query('DELETE FROM purchases WHERE order_id = $1', [id]);
      await c.query(`UPDATE orders SET status = 'refunded', refunded_at = now(), status_note = $2, status_by = $3 WHERE id = $1`, [id, note, req.admin.id]);
      await audit(c, req.admin.id, 'order.refund', { userId: o.user_id, target: id, note, meta: { title: o.item_name, sumKop: o.amount_kop } });
      return {};
    });
    if (out.err) return bad(reply, ...out.err);
    return { ok: true };
  });
}
