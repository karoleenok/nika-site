import crypto from 'node:crypto';

// Случайный токен для куки и ссылки из письма (32 байта)
export const newToken = () => crypto.randomBytes(32).toString('base64url');

// В базе храним только хеш токена: утечка базы не даёт войти
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest();

// Код из письма: 6 цифр, равномерно
export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// Хеш кода с секретом: 6 цифр перебираются быстро, без секрета хеш бесполезен
export const hashCode = (secret, email, code) =>
  crypto.createHmac('sha256', secret).update(`${String(email).toLowerCase()}:${code}`).digest();

export const sameBytes = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

export const normEmail = (v) => String(v ?? '').trim().toLowerCase();
export const validEmail = (v) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
