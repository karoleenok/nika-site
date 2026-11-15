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

// Клиенты без почты (купили через WhatsApp) входят по телефону.
// В колонке email у них служебный адрес в зоне .invalid: такие адреса не существуют по стандарту (RFC 2606),
// письма на них не уходят (см. mail.js), а уникальность почты в базе продолжает работать.
const PHONE_MAIL = '@phone.invalid';
export const phoneDigits = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '8' ? '7' + d.slice(1) : d.length === 10 && d[0] === '9' ? '7' + d : d;
};
export const validPhoneDigits = (d) => d.length >= 10 && d.length <= 15;
export const phoneEmail = (d) => `tel${d}${PHONE_MAIL}`;
export const isPhoneEmail = (e) => String(e ?? '').endsWith(PHONE_MAIL);
// Что показывать клиенту как логин: почту или телефон
export const loginOf = (email) => (isPhoneEmail(email) ? '+' + String(email).slice(3, -PHONE_MAIL.length) : String(email ?? ''));
// Что ввёл человек в поле входа: почту или телефон → адрес в базе
export const loginToEmail = (v) => {
  const s = String(v ?? '').trim();
  if (s.includes('@')) return normEmail(s);
  const d = phoneDigits(s);
  return /^[+\d\s()\-]{6,25}$/.test(s) && validPhoneDigits(d) ? phoneEmail(d) : '';
};
