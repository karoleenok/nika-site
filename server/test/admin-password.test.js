import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf } from './helpers.js';
import { hashPassword } from '../src/auth/password.js';
import { bootstrapProd } from '../scripts/seed.js';

let t;
const ck = (r) => cookieOf(r, r.cookies[0].name).header;
before(async () => {
  t = await setup();
  await t.pool.query(`INSERT INTO admins (email, name, role, password_hash) VALUES ('owner@x.com','Ника','owner',$1),('off@x.com','Выкл','staff',$1)`, [await hashPassword('Correct-Horse-7')]);
  await t.pool.query(`UPDATE admins SET active = false WHERE email = 'off@x.com'`);
});
after(() => t.close());

const login = (email, password, ip = t.freshIp()) => t.api('POST', '/api/auth/password', { email, password, kind: 'admin', remember: true }, { ip });

test('админ входит по почте и паролю, неверный пароль и выключенный админ не пускают', async () => {
  const bad = await login('owner@x.com', 'wrong-password');
  assert.equal(bad.statusCode, 400);
  assert.equal((await login('nobody@x.com', 'Correct-Horse-7')).statusCode, 400);
  assert.equal((await login('off@x.com', 'Correct-Horse-7')).statusCode, 400);
  const ok = await login('OWNER@x.com', 'Correct-Horse-7');
  assert.equal(ok.statusCode, 200);
  const me = await t.api('GET', '/api/admin/me', undefined, { cookie: ck(ok) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().role, 'owner');
});

test('пароль клиента не открывает админку и наоборот', async () => {
  await t.pool.query(`INSERT INTO users (email, name, password_hash) VALUES ('client@x.com','К',$1)`, [await hashPassword('Client-Pass-77')]);
  const r = await login('client@x.com', 'Client-Pass-77');
  assert.equal(r.statusCode, 400);
});

test('смена пароля: нужен текущий, слабый не принимается, старый перестаёт работать', async () => {
  const c = ck(await login('owner@x.com', 'Correct-Horse-7'));
  const put = (body) => t.api('PUT', '/api/admin/password', body, { cookie: c });
  assert.equal((await put({ current: 'nope', password: 'Another-Strong-9' })).statusCode, 400);
  assert.equal((await put({ current: 'Correct-Horse-7', password: '12345678' })).statusCode, 400);
  assert.equal((await put({ current: 'Correct-Horse-7', password: 'Another-Strong-9' })).statusCode, 200);
  assert.equal((await login('owner@x.com', 'Correct-Horse-7')).statusCode, 400);
  assert.equal((await login('owner@x.com', 'Another-Strong-9')).statusCode, 200);
});

test('стартовый пароль из seed ставится только тем, у кого пароля нет', async () => {
  await t.pool.query(`DELETE FROM admins WHERE email IN ('nikadupina74@gmail.com','karolinabelikova90@gmail.com')`);
  await bootstrapProd(t.pool, { INITIAL_ADMINS: 'owner:nikadupina74@gmail.com:Ника,tech:karolinabelikova90@gmail.com:Каролина' }, () => {});
  const r = await t.pool.query(`SELECT email, password_hash IS NOT NULL AS has FROM admins WHERE email IN ('nikadupina74@gmail.com','karolinabelikova90@gmail.com')`);
  assert.equal(r.rowCount, 2);
  assert.ok(r.rows.every((x) => x.has));
});
