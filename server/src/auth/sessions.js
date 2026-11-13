import { newToken, hashToken } from './crypto.js';

const DAY = 864e5;
// Сроки жизни. «Запомнить меня»: кабинет 30 дней со скользящим продлением, админка 14 дней.
// Без галочки кука живёт до закрытия браузера, а на сервере сессия умирает через 12 часов без действий.
export const LIFETIME = {
  user:  { persistent: 30 * DAY, sliding: true },
  admin: { persistent: 14 * DAY, sliding: false },
  temp: 12 * 3600e3,
};
const SLIDE_EVERY = 3600e3; // продлеваем не чаще раза в час, чтобы не писать в базу на каждый запрос

export function cookieName(kind, secure) {
  const base = kind === 'admin' ? 'nika_adm' : 'nika_lk';
  return secure ? `__Host-${base}` : base; // __Host-: только https, только наш домен, path=/
}

export function cookieOptions(secure, maxAgeMs) {
  const o = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  if (maxAgeMs) o.maxAge = Math.floor(maxAgeMs / 1000);
  return o;
}

export async function createSession(db, { kind, id, persistent }) {
  const token = newToken();
  const ms = persistent ? LIFETIME[kind].persistent : LIFETIME.temp;
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, admin_id, persistent, expires_at)
     VALUES ($1, $2, $3, $4, now() + $5 * interval '1 millisecond')`,
    [hashToken(token), kind === 'user' ? id : null, kind === 'admin' ? id : null, persistent, ms]);
  return { token, maxAgeMs: persistent ? ms : 0 };
}

// Находит живую сессию по куке. Возвращает { session, refresh } — refresh: нужно перевыпустить куку с новым сроком.
export async function readSession(db, kind, token) {
  if (!token || token.length > 100) return null;
  const col = kind === 'admin' ? 'admin_id' : 'user_id';
  const { rows } = await db.query(
    `SELECT s.id, s.${col} AS owner_id, s.persistent, s.last_seen_at, s.expires_at
       FROM sessions s
       ${kind === 'admin' ? 'JOIN admins a ON a.id = s.admin_id AND a.active' : ''}
      WHERE s.token_hash = $1 AND s.${col} IS NOT NULL AND s.expires_at > now()`,
    [hashToken(token)]);
  const s = rows[0];
  if (!s) return null;
  const since = Date.now() - new Date(s.last_seen_at).getTime();
  if (since < SLIDE_EVERY) return { session: s, refresh: 0 };
  const slide = s.persistent ? LIFETIME[kind].sliding : true; // временная сессия всегда скользит (12 ч без действий)
  if (slide) {
    const ms = s.persistent ? LIFETIME[kind].persistent : LIFETIME.temp;
    await db.query(`UPDATE sessions SET last_seen_at = now(), expires_at = now() + $2 * interval '1 millisecond' WHERE id = $1`, [s.id, ms]);
    return { session: s, refresh: s.persistent ? ms : 0 };
  }
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.id]);
  return { session: s, refresh: 0 };
}

export const deleteSession = (db, token) => db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);

export const deleteOtherUserSessions = (db, userId, keepSessionId) =>
  db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, keepSessionId]);
