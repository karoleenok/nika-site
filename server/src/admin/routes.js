// Админка: клиенты, доступ, тарифы, журнал. Роль проверяется на сервере в каждом маршруте.
// owner (Ника) — всё. tech (Каролина) — всё. staff (Диана) — клиенты и доступ, без цен и журнала.
import { tx } from '../db.js';
import { normEmail, validEmail } from '../auth/crypto.js';
import { CLIENT_SELECT, clientView, audit, DAY, MAX_FUTURE_DAYS } from '../access.js';

const bad = (reply, status, error) => reply.code(status).send({ error });
const idOf = (v) => (/^\d{1,15}$/.test(String(v)) ? String(v) : null);
const cleanPhone = (v) => String(v ?? '').trim();
const phoneOk = (v) => v === '' || (/^[+\d\s()\-]{6,25}$/.test(v) && v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 15);
const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);

const only = (...roles) => async (req, reply) => {
  if (!roles.includes(req.admin.role)) return bad(reply, 403, 'Этот раздел недоступен для твоей роли.');
};
const money = only('owner', 'tech');

export default async function adminRoutes(app, { pool }) {
  const noStore = (reply) => reply.header('cache-control', 'no-store');

  // ---------- Клиенты ----------
  app.get('/api/admin/clients', async (req, reply) => {
    noStore(reply);
    const { rows } = await pool.query(`${CLIENT_SELECT} ORDER BY u.id LIMIT 2000`);
    const now = new Date();
    return { clients: rows.map((r) => clientView(r, now)) };
  });

  app.get('/api/admin/clients/:id', async (req, reply) => {
    noStore(reply);
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Клиент не найден');
    const { rows } = await pool.query(`${CLIENT_SELECT} WHERE u.id = $1`, [id]);
    if (!rows[0]) return bad(reply, 404, 'Клиент не найден');
    const [pay, hist] = await Promise.all([
      pool.query(`SELECT o.item_name, o.amount_kop, o.status, o.paid_at, o.created_at FROM orders o
                   WHERE o.user_id = $1 AND o.status IN ('paid','manual','refunded') ORDER BY coalesce(o.paid_at, o.created_at) DESC LIMIT 50`, [id]),
      pool.query(`SELECT l.id, l.action, l.note, l.meta, l.created_at, a.name AS who FROM audit_log l LEFT JOIN admins a ON a.id = l.admin_id
                   WHERE l.user_id = $1 ORDER BY l.id DESC LIMIT 100`, [id]),
    ]);
    return {
      client: clientView(rows[0]),
      payments: pay.rows.map((p) => ({ title: p.item_name, sumKop: p.amount_kop, status: p.status, at: p.paid_at || p.created_at })),
      history: hist.rows.map(logView),
    };
  });

  app.post('/api/admin/clients', async (req, reply) => {
    const name = cleanText(req.body?.name, 100), email = normEmail(req.body?.email), phone = cleanPhone(req.body?.phone);
    if (!name) return bad(reply, 400, 'Напиши имя.');
    if (!validEmail(email)) return bad(reply, 400, 'Проверь почту: похоже, опечатка.');
    if (!phoneOk(phone)) return bad(reply, 400, 'Телефон: цифры, можно с плюсом. Или оставь пустым.');
    const dup = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (dup.rowCount) return bad(reply, 409, 'Клиент с такой почтой уже есть.');
    const id = await tx(pool, async (c) => {
      const r = await c.query('INSERT INTO users (email, name, phone) VALUES ($1, $2, $3) RETURNING id', [email, name, phone]);
      await audit(c, req.admin.id, 'client.create', { userId: r.rows[0].id });
      return r.rows[0].id;
    });
    return reply.code(201).send({ id: String(id) });
  });

  // Правка данных и заметки. Приходят только те поля, которые меняем.
  app.patch('/api/admin/clients/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Клиент не найден');
    const b = req.body || {};
    return tx(pool, async (c) => {
      const cur = (await c.query('SELECT id, name, email, phone, note FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) return bad(reply, 404, 'Клиент не найден');
      const next = { ...cur };
      if ('name' in b) { next.name = cleanText(b.name, 100); if (!next.name) return bad(reply, 400, 'Напиши имя.'); }
      if ('email' in b) {
        next.email = normEmail(b.email);
        if (!validEmail(next.email)) return bad(reply, 400, 'Проверь почту: похоже, опечатка.');
        if (next.email !== cur.email && (await c.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [next.email, id])).rowCount) return bad(reply, 409, 'Клиент с такой почтой уже есть.');
      }
      if ('phone' in b) { next.phone = cleanPhone(b.phone); if (!phoneOk(next.phone)) return bad(reply, 400, 'Телефон: цифры, можно с плюсом. Или оставь пустым.'); }
      if ('note' in b) next.note = cleanText(b.note, 500);
      await c.query('UPDATE users SET name = $2, email = $3, phone = $4, note = $5 WHERE id = $1', [id, next.name, next.email, next.phone, next.note]);
      // Сменили почту: старые сессии закрываем, чтобы прежний владелец адреса не остался внутри
      if (next.email !== cur.email) await c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      const changed = ['name', 'email', 'phone'].filter((k) => next[k] !== cur[k]);
      if (changed.length) await audit(c, req.admin.id, 'client.update', { userId: id, meta: { fields: changed } });
      else if (next.note !== cur.note) await audit(c, req.admin.id, 'client.note', { userId: id });
      return { ok: true };
    });
  });

  // «Напомнили о продлении»: Ника написала клиенту в WhatsApp. Запоминаем, чтобы не напоминать дважды подряд.
  app.post('/api/admin/clients/:id/remind', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id || !(await pool.query('SELECT 1 FROM users WHERE id = $1', [id])).rowCount) return bad(reply, 404, 'Клиент не найден');
    await audit(pool, req.admin.id, 'client.remind', { userId: id });
    return { ok: true };
  });

  // ---------- Доступ ----------
  // Продлить или открыть. Считаем от текущей даты окончания, если доступ идёт, иначе от сейчас.
  // Новый период пишем отдельной строкой: так в истории видно, кто и когда добавил недели.
  app.post('/api/admin/clients/:id/access', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Клиент не найден');
    const days = Number(req.body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 366) return bad(reply, 400, 'Выбери срок.');
    const note = cleanText(req.body?.note, 120) || null;
    const tariffId = req.body?.tariffId == null ? null : idOf(req.body.tariffId);
    if (req.body?.tariffId != null && !tariffId) return bad(reply, 400, 'Выбери тариф.');

    return tx(pool, async (c) => {
      // Блокируем клиента: два быстрых нажатия не продлят доступ дважды в обход проверок
      if (!(await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [id])).rowCount) return bad(reply, 404, 'Клиент не найден');
      const active = (await c.query(`SELECT max(ends_at) AS e FROM access_periods WHERE user_id = $1 AND closed_at IS NULL AND ends_at > now()`, [id])).rows[0].e;
      let tid = tariffId;
      if (tid) {
        const t = await c.query(`SELECT 1 FROM tariffs WHERE id = $1 AND kind = 'access'`, [tid]);
        if (!t.rowCount) return bad(reply, 400, 'Такого тарифа нет.');
      } else {
        const last = await c.query('SELECT tariff_id FROM access_periods WHERE user_id = $1 ORDER BY ends_at DESC, id DESC LIMIT 1', [id]);
        tid = last.rows[0]?.tariff_id ?? null;
        if (!tid) return bad(reply, 400, 'Выбери тариф: у клиента ещё не было доступа.');
      }
      const base = active ? new Date(active) : new Date();
      const ends = new Date(base.getTime() + days * DAY);
      if (ends - Date.now() > MAX_FUTURE_DAYS * DAY) return bad(reply, 400, 'Слишком далеко вперёд. Проверь срок.');
      const ins = await c.query(
        `INSERT INTO access_periods (user_id, tariff_id, starts_at, ends_at, source, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [id, tid, base, ends, active ? 'extend' : 'manual', req.admin.id]);
      await audit(c, req.admin.id, active ? 'access.extend' : 'access.open', { userId: id, note, meta: { days, endsAt: ends.toISOString(), tariffId: tid } });
      return { ok: true, endsAt: ends.toISOString(), periodId: String(ins.rows[0].id) };
    });
  });

  // Отмена случайного продления: только свежее (15 минут), только последнее, только ручное (оплаты так не отменяются)
  app.post('/api/admin/clients/:id/access/undo', async (req, reply) => {
    const id = idOf(req.params.id), pid = idOf(req.body?.periodId);
    if (!id || !pid) return bad(reply, 404, 'Не найдено');
    return tx(pool, async (c) => {
      if (!(await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [id])).rowCount) return bad(reply, 404, 'Клиент не найден');
      const p = (await c.query(
        `SELECT p.id, p.ends_at, p.created_by FROM access_periods p
          WHERE p.id = $1 AND p.user_id = $2 AND p.source IN ('manual','extend') AND p.closed_at IS NULL
            AND p.created_at > now() - interval '15 minutes'
            AND NOT EXISTS (SELECT 1 FROM access_periods q WHERE q.user_id = p.user_id AND q.id > p.id)`, [pid, id])).rows[0];
      if (!p) return bad(reply, 400, 'Отменить уже нельзя: прошло время или есть более новые изменения.');
      await c.query('DELETE FROM access_periods WHERE id = $1', [pid]);
      await audit(c, req.admin.id, 'access.undo', { userId: id, meta: { endsAt: new Date(p.ends_at).toISOString() } });
      return { ok: true };
    });
  });

  app.post('/api/admin/clients/:id/access/close', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Клиент не найден');
    const note = cleanText(req.body?.note, 120) || null;
    return tx(pool, async (c) => {
      if (!(await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [id])).rowCount) return bad(reply, 404, 'Клиент не найден');
      const r = await c.query(`UPDATE access_periods SET closed_at = now(), close_note = $2
                                WHERE user_id = $1 AND closed_at IS NULL AND ends_at > now()`, [id, note]);
      if (!r.rowCount) return bad(reply, 400, 'Доступ уже закончился.');
      await audit(c, req.admin.id, 'access.close', { userId: id, note });
      return { ok: true };
    });
  });

  // ---------- Покупки на «Сегодня» ----------
  app.get('/api/admin/purchases', async (req, reply) => {
    noStore(reply);
    const { rows } = await pool.query(
      `SELECT o.id, o.item_name, o.amount_kop, coalesce(o.paid_at, o.created_at) AS at, coalesce(nullif(u.name, ''), o.email::text) AS client
         FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.status IN ('paid','manual') ORDER BY at DESC LIMIT 5`);
    return { purchases: rows.map((r) => ({ id: String(r.id), client: r.client, title: r.item_name, sumKop: r.amount_kop, at: r.at })) };
  });

  // ---------- Тарифы и цены ----------
  app.get('/api/admin/tariffs', { preHandler: money }, async (req, reply) => {
    noStore(reply);
    const { rows } = await pool.query('SELECT id, slug, kind, grp, name, price_kop, old_price_kop, access_days FROM tariffs WHERE active ORDER BY sort, id');
    return { tariffs: rows.map(tariffView) };
  });

  // Цены в рублях целыми числами. Старая цена 0 = не показывать.
  app.patch('/api/admin/tariffs/:id', { preHandler: money }, async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Тариф не найден');
    const price = Number(req.body?.price), old = Number(req.body?.old ?? 0);
    if (!Number.isInteger(price) || price < 1 || price > 1_000_000) return bad(reply, 400, 'Укажи цену цифрами.');
    if (!Number.isInteger(old) || old < 0 || old > 1_000_000) return bad(reply, 400, 'Старая цена: цифры или пусто.');
    if (old && old <= price) return bad(reply, 400, 'Старая цена должна быть выше новой, иначе скидки нет.');
    return tx(pool, async (c) => {
      const cur = (await c.query('SELECT id, name, price_kop, old_price_kop FROM tariffs WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) return bad(reply, 404, 'Тариф не найден');
      await c.query('UPDATE tariffs SET price_kop = $2, old_price_kop = $3 WHERE id = $1', [id, price * 100, old * 100]);
      await audit(c, req.admin.id, 'tariff.price', { target: `tariff:${id}`, meta: { name: cur.name, from: cur.price_kop / 100, to: price } });
      return { ok: true };
    });
  });

  // ---------- Журнал ----------
  app.get('/api/admin/log', { preHandler: money }, async (req, reply) => {
    noStore(reply);
    // Входы в админку в общий журнал не выводим: они только шумят. В базе они остаются.
    const { rows } = await pool.query(
      `SELECT l.id, l.action, l.note, l.meta, l.created_at, a.name AS who, u.id AS uid, u.name AS client
         FROM audit_log l LEFT JOIN admins a ON a.id = l.admin_id LEFT JOIN users u ON u.id = l.user_id
        WHERE l.action <> 'login' ORDER BY l.id DESC LIMIT 200`);
    return { log: rows.map((r) => ({ ...logView(r), clientId: r.uid ? String(r.uid) : null, client: r.client || null })) };
  });
}

const logView = (r) => ({ id: String(r.id), action: r.action, note: r.note || '', meta: r.meta || null, at: r.created_at, who: r.who || '' });
export const tariffView = (r) => ({
  id: String(r.id), slug: r.slug, kind: r.kind, group: r.grp, name: r.name,
  price: r.price_kop / 100, old: r.old_price_kop / 100, weeks: r.access_days >= 7 ? Math.round(r.access_days / 7) : 0, days: r.access_days,
});
