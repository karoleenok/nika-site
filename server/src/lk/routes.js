// Кабинет клиента: «Мой доступ» и оплаты. Публичный список цен.
import { CLIENT_SELECT, accessView } from '../access.js';
import { tariffView } from '../admin/routes.js';

export default async function lkRoutes(app, { pool }) {
  app.get('/api/me/access', { preHandler: app.requireUser }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const { rows } = await pool.query(`${CLIENT_SELECT} WHERE u.id = $1`, [req.auth.id]);
    const pay = await pool.query(
      `SELECT item_name, amount_kop, coalesce(paid_at, created_at) AS at FROM orders
        WHERE user_id = $1 AND status IN ('paid','manual') ORDER BY at DESC LIMIT 50`, [req.auth.id]);
    const v = accessView(rows[0]);
    // Клиенту отдаём только то, что нужно экрану
    return {
      state: v.state, endsAt: v.endsAt, daysLeft: v.daysLeft, daysAgo: v.daysAgo ?? 0, spanDays: v.spanDays, closed: v.closed, plan: v.plan,
      payments: pay.rows.map((p) => ({ title: p.item_name, sumKop: p.amount_kop, at: p.at })),
    };
  });

  // Цены с сервера: одна правда для лендинга, оформления и админки
  app.get('/api/tariffs', async (req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    const { rows } = await pool.query('SELECT id, slug, kind, grp, name, price_kop, old_price_kop, access_days FROM tariffs WHERE active ORDER BY sort, id');
    return { tariffs: rows.map(tariffView) };
  });
}
