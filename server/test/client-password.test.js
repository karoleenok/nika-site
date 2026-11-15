import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf } from './helpers.js';
import { hashPassword } from '../src/auth/password.js';
import { generateClientPassword, WORD_COUNT } from '../src/auth/genpass.js';
import { passwordProblem } from '../src/auth/password.js';
import { loadConfig } from '../src/config.js';

let t, admin, uid;
const ck = (r) => cookieOf(r, r.cookies[0].name).header;
before(async () => {
  t = await setup();
  await t.pool.query(`INSERT INTO admins (email, name, role, password_hash) VALUES ('owner@x.com','Ника','owner',$1)`, [await hashPassword('Correct-Horse-7')]);
  admin = ck(await t.api('POST', '/api/auth/password', { email: 'owner@x.com', password: 'Correct-Horse-7', kind: 'admin' }, { ip: t.freshIp() }));
  uid = (await t.api('POST', '/api/admin/clients', { name: 'Аня', email: 'anya@example.com', phone: '' }, { cookie: admin })).json().id;
});
after(() => t.close());

const give = (body, cookie = admin, id = uid) => t.api('POST', `/api/admin/clients/${id}/password`, body, { cookie: cookie || undefined });
const signIn = (password, email = 'anya@example.com') => t.api('POST', '/api/auth/password', { email, password }, { ip: t.freshIp() });

test('генератор: слово-слово-цифры, проходит проверку пароля, не повторяется', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const p = generateClientPassword();
    assert.match(p, /^[a-z]{2,12}-[a-z]{2,12}-\d{4}$/);
    const [a, b] = p.split('-'); assert.notEqual(a, b);
    assert.equal(passwordProblem(p, 'anya@example.com'), '');
    seen.add(p);
  }
  assert.ok(seen.size >= 299);
  assert.ok(WORD_COUNT >= 300, 'словарь не меньше 300 слов');
});

test('без входа в админку и с сессией клиента пароль не выдаётся', async () => {
  assert.equal((await give({}, null)).statusCode, 401);
  await t.pool.query(`INSERT INTO users (email, name, password_hash) VALUES ('eve@example.com','Ева',$1)`, [await hashPassword('Eve-Strong-Pass-1')]);
  const eve = ck(await signIn('Eve-Strong-Pass-1', 'eve@example.com'));
  assert.equal((await give({}, eve)).statusCode, 401);
  assert.equal((await give({}, admin, '999999')).statusCode, 404);
  assert.equal((await give({}, admin, 'abc')).statusCode, 404);
});

test('админ задаёт пароль: клиент входит без писем, кабинет просит сменить, в базе и журнале пароля нет', async () => {
  t.mails.length = 0;
  const r = await give({ mustChange: true });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  const { password, email, mustChange } = r.json();
  assert.equal(email, 'anya@example.com'); assert.equal(mustChange, true);
  assert.equal(t.mails.length, 0, 'почта не нужна');

  const db = (await t.pool.query('SELECT password_hash, password_temp FROM users WHERE id = $1', [uid])).rows[0];
  assert.match(db.password_hash, /^\$argon2id\$/); assert.equal(db.password_temp, true);
  const log = (await t.pool.query(`SELECT meta, note FROM audit_log WHERE action = 'client.password' AND user_id = $1`, [uid])).rows;
  assert.equal(log.length, 1);
  assert.ok(!JSON.stringify(log[0]).includes(password), 'в журнале пароля нет');

  const card = (await t.api('GET', `/api/admin/clients/${uid}`, undefined, { cookie: admin })).json();
  assert.equal(card.client.hasPassword, true); assert.equal(card.client.passwordTemp, true);
  assert.ok(!JSON.stringify(card).includes(password));

  const s = await signIn(password);
  assert.equal(s.statusCode, 200);
  const c = ck(s);
  const me = (await t.api('GET', '/api/me', undefined, { cookie: c })).json();
  assert.equal(me.mustChangePassword, true);

  assert.equal((await t.api('PUT', '/api/me/password', { password }, { cookie: c })).statusCode, 400, 'тот же пароль не принимается');
  assert.equal((await t.api('PUT', '/api/me/password', { password: 'Мой новый пароль 9' }, { cookie: c })).statusCode, 200);
  assert.equal((await t.api('GET', '/api/me', undefined, { cookie: c })).json().mustChangePassword, false);
  assert.equal((await signIn(password)).statusCode, 400, 'временный больше не работает');
  assert.equal((await signIn('Мой новый пароль 9')).statusCode, 200);
});

test('повторная выдача: старый пароль и старые сессии перестают работать; mustChange можно выключить', async () => {
  const old = ck(await signIn('Мой новый пароль 9'));
  const r = (await give({ mustChange: false })).json();
  assert.equal(r.mustChange, false);
  assert.equal((await t.api('GET', '/api/me', undefined, { cookie: old })).statusCode, 401, 'прежняя сессия закрыта');
  assert.equal((await signIn('Мой новый пароль 9')).statusCode, 400);
  const c = ck(await signIn(r.password));
  assert.equal((await t.api('GET', '/api/me', undefined, { cookie: c })).json().mustChangePassword, false);
  const meta = (await t.pool.query(`SELECT meta FROM audit_log WHERE action = 'client.password' AND user_id = $1 ORDER BY id DESC LIMIT 1`, [uid])).rows[0].meta;
  assert.deepEqual(meta, { reset: true, mustChange: false });
});

test('пароль клиента не открывает админку', async () => {
  const r = (await give({ mustChange: true })).json();
  const a = await t.api('POST', '/api/auth/password', { email: 'anya@example.com', password: r.password, kind: 'admin' }, { ip: t.freshIp() });
  assert.equal(a.statusCode, 400);
});

test('настройка mailOn: на бою без SMTP_USER почта считается выключенной; экран входа узнаёт это из /api/auth/config', async () => {
  const base = { ...process.env, NODE_ENV: 'production', PUBLIC_URL: 'https://x.ru', SESSION_SECRET: 'a'.repeat(64),
    ROBOKASSA_LOGIN: 'a', ROBOKASSA_PASSWORD1: 'b', ROBOKASSA_PASSWORD2: 'c', SMTP_USER: '', SMTP_PASSWORD: '', MAIL_ENABLED: '' };
  assert.equal(loadConfig(base).mailOn, false);
  assert.equal(loadConfig({ ...base, SMTP_USER: 'u', SMTP_PASSWORD: 'p' }).mailOn, true);
  assert.equal(loadConfig({ ...base, SMTP_USER: 'u', SMTP_PASSWORD: 'p', MAIL_ENABLED: '0' }).mailOn, false);
  const r = await t.api('GET', '/api/auth/config');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { mail: true });
});
