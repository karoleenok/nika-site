// Без почты: после оплаты сайт сам выдаёт вход, показывает его на «спасибо» и в профиле; стартовые уроки.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setup, cookieOf } from './helpers.js';
import { starterContent } from '../scripts/seed.js';
import { sealPassword, openPassword } from '../src/auth/shown.js';

let t;
before(async () => { t = await setup({ MAIL_ENABLED: '0' }); });
after(() => t.close());

const sign = (o) => crypto.createHash('md5').update(`${o.OutSum}:${o.InvId}:${t.config.robokassa.password2}`).digest('hex');
async function buy(email) {
  const slug = (await t.pool.query(`SELECT slug FROM tariffs WHERE kind = 'access' AND active AND price_kop > 0 LIMIT 1`)).rows[0]?.slug;
  const s = await t.api('POST', '/api/pay/start', { email, item: slug, consent: true, agree: true }, { ip: t.freshIp() });
  assert.equal(s.statusCode, 200, s.body);
  const { orderId, key } = s.json();
  const kop = (await t.pool.query('SELECT amount_kop FROM orders WHERE id = $1', [orderId])).rows[0].amount_kop;
  const p = { OutSum: (kop / 100).toFixed(2), InvId: orderId }; p.SignatureValue = sign(p);
  const r = await t.app.inject({ method: 'POST', url: '/api/pay/result', payload: new URLSearchParams(p).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.body, 'OK' + orderId);
  return { orderId, key };
}

test('шифр пароля: открывается своим секретом, чужим нет', () => {
  const s = sealPassword('a'.repeat(64), 'слово-слово-1234');
  assert.equal(openPassword('a'.repeat(64), s), 'слово-слово-1234');
  assert.equal(openPassword('b'.repeat(64), s), null);
});

test('оплата → пароль выдан, «спасибо» показывает вход и открывает кабинет, профиль показывает пароль', async () => {
  if (!(await t.pool.query(`SELECT 1 FROM tariffs WHERE kind = 'access' AND active AND price_kop > 0`)).rowCount) {
    await t.pool.query(`INSERT INTO tariffs (slug, kind, grp, name, price_kop, access_days, sort) VALUES ('t-test','access','x','Тест',100000,28,1)`);
  }
  const { orderId, key } = await buy('new@x.com');
  const st = await t.api('GET', `/api/pay/status/${orderId}?k=${key}&enter=1`);
  const j = st.json();
  assert.equal(j.status, 'paid'); assert.equal(j.login.email, 'new@x.com'); assert.equal(j.entered, true);
  const ck = cookieOf(st, st.cookies[0].name).header;
  const me = (await t.api('GET', '/api/me', undefined, { cookie: ck })).json();
  assert.equal(me.shownPassword, j.login.password); assert.equal(me.passwordLocked, true);
  assert.equal((await t.api('PUT', '/api/me/password', { password: 'My-Own-Pass-77' }, { cookie: ck })).statusCode, 400);
  const login = await t.api('POST', '/api/auth/password', { email: 'new@x.com', password: j.login.password }, { ip: t.freshIp() });
  assert.equal(login.statusCode, 200);
  // чужой ключ ничего не показывает
  assert.equal((await t.api('GET', `/api/pay/status/${orderId}?k=wrong`)).statusCode, 404);
  // доступ появился
  assert.equal((await t.api('GET', '/api/me/access', undefined, { cookie: ck })).json().payments.length, 1);
});

test('у кого пароль уже был, повторная покупка его не меняет и не показывает', async () => {
  await t.pool.query(`UPDATE users SET password_shown = NULL WHERE email = 'new@x.com'`);
  const { orderId, key } = await buy('new@x.com');
  assert.equal((await t.api('GET', `/api/pay/status/${orderId}?k=${key}`)).json().login, undefined);
});

test('стартовые уроки ставятся один раз и не возвращаются после удаления', async () => {
  await starterContent(t.pool);
  const n = (await t.pool.query('SELECT count(*)::int n FROM videos')).rows[0].n;
  assert.ok(n >= 30);
  await t.pool.query(`DELETE FROM videos WHERE title = 'Экстензия'`);
  await starterContent(t.pool);
  assert.equal((await t.pool.query(`SELECT count(*)::int n FROM videos WHERE title = 'Экстензия'`)).rows[0].n, 0);
  assert.equal((await t.pool.query(`SELECT count(*)::int n FROM videos WHERE status <> 'empty' OR published`)).rows[0].n, 0);
});
