// Доступ клиента: как считается статус и срок. Срок в базе в днях, в интерфейсе недели.
// Действующий доступ = период, не закрытый вручную, который ещё не закончился.
export const DAY = 864e5;
export const WARN_DAYS = 7;          // «заканчивается»: осталось 7 дней и меньше
export const MAX_FUTURE_DAYS = 800;  // защита от опечатки: дальше этого вперёд не продлеваем

// Строка из SQL (см. CLIENT_SELECT) -> то, что показывает интерфейс.
// state: ok (идёт), warn (скоро конец), bad (закончился или закрыт), none (доступа не было)
export function accessView(row, now = new Date()) {
  const plan = row.tariff_name ? { name: row.tariff_name, weeks: row.tariff_days >= 7 ? Math.round(row.tariff_days / 7) : 0 } : null;
  if (row.active_end) {
    const end = new Date(row.active_end);
    const daysLeft = Math.ceil((end - now) / DAY);
    const span = Math.max(1, Math.round((end - new Date(row.chain_start)) / DAY));
    // Доступ на 24 часа не считаем «заканчивающимся»: он короткий по задумке
    const state = daysLeft <= WARN_DAYS && span > 1 ? 'warn' : 'ok';
    return { state, endsAt: end.toISOString(), daysLeft, spanDays: span, closed: false, plan };
  }
  if (row.last_end) {
    const closed = !!row.last_closed_at;
    const endedAt = new Date(closed ? row.last_closed_at : row.last_end);
    return { state: 'bad', endsAt: endedAt.toISOString(), daysLeft: 0, daysAgo: Math.max(0, Math.floor((now - endedAt) / DAY)), spanDays: 0, closed, plan };
  }
  return { state: 'none', endsAt: null, daysLeft: 0, spanDays: 0, closed: false, plan: null };
}

// Общий кусок запроса: клиент + его текущее состояние доступа + когда ему последний раз напоминали о продлении
export const CLIENT_SELECT = `
  SELECT u.id, u.name, u.email, u.phone, u.note, u.created_at,
         a.active_end, a.chain_start,
         l.ends_at AS last_end, l.closed_at AS last_closed_at, l.tariff_id, l.tariff_name, l.tariff_days,
         r.at AS last_remind_at
    FROM users u
    LEFT JOIN LATERAL (
      SELECT max(ends_at) AS active_end, min(starts_at) AS chain_start
        FROM access_periods WHERE user_id = u.id AND closed_at IS NULL AND ends_at > now()) a ON true
    LEFT JOIN LATERAL (
      SELECT p.ends_at, p.closed_at, p.tariff_id, t.name AS tariff_name, t.access_days AS tariff_days
        FROM access_periods p LEFT JOIN tariffs t ON t.id = p.tariff_id
       WHERE p.user_id = u.id
       ORDER BY (p.closed_at IS NULL AND p.ends_at > now()) DESC, p.ends_at DESC, p.id DESC LIMIT 1) l ON true
    LEFT JOIN LATERAL (
      SELECT max(created_at) AS at FROM audit_log WHERE user_id = u.id AND action = 'client.remind') r ON true`;

export function clientView(row, now = new Date()) {
  return {
    id: String(row.id), name: row.name, email: row.email, phone: row.phone, note: row.note,
    createdAt: row.created_at,
    // «Напомнили» держим 3 дня, потом снова можно напоминать
    reminded: !!row.last_remind_at && now - new Date(row.last_remind_at) < 3 * DAY,
    tariffId: row.tariff_id ? String(row.tariff_id) : null,
    ...accessView(row, now),
  };
}

// Запись в журнал. Имя клиента в журнал не пишем: оно подтягивается из карточки (удалили клиента — следов нет).
export const audit = (db, adminId, action, { userId = null, target = null, note = null, meta = null } = {}) =>
  db.query('INSERT INTO audit_log (admin_id, action, user_id, target, note, meta) VALUES ($1, $2, $3, $4, $5, $6)',
    [adminId, action, userId, target, note, meta]);
