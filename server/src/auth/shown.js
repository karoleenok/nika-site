// Шифрование пароля, который клиенту нужно видеть в профиле (пока нет почты и восстановления).
// Ключ выводится из SESSION_SECRET: утечка одной базы без секрета сервера паролей не раскрывает.
import crypto from 'node:crypto';
import { hashPassword } from './password.js';
import { generateClientPassword } from './genpass.js';

const keyOf = (secret) => crypto.createHash('sha256').update('nika:password-shown:v1:' + secret).digest();

export function sealPassword(secret, pw) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const body = Buffer.concat([c.update(pw, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function openPassword(secret, sealed) {
  try {
    const [v, iv, tag, body] = String(sealed || '').split('.');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}

// После оплаты: у клиента без пароля появляется пароль от сайта. У кого пароль уже есть — ничего не меняем.
export async function issueIfNoPassword(c, userId, secret) {
  const u = (await c.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0];
  if (!u || u.password_hash) return null;
  const pw = generateClientPassword();
  await c.query('UPDATE users SET password_hash = $2, password_temp = false, password_shown = $3 WHERE id = $1',
    [userId, await hashPassword(pw), sealPassword(secret, pw)]);
  return pw;
}
