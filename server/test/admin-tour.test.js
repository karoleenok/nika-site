// Экскурсия по админке: отметка «пройдена» живёт на сервере у каждого админа отдельно.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf } from './helpers.js';
import { hashPassword } from '../src/auth/password.js';

let t, nika, staff;
const ck = (r) => cookieOf(r, r.cookies[0].name).header;
const login = async (email) => ck(await t.api('POST', '/api/auth/password', { email, password: 'Correct-Horse-7', kind: 'admin' }, { ip: t.freshIp() }));
const me = async (c) => (await t.api('GET', '/api/admin/me', undefined, { cookie: c })).json();

before(async () => {
  t = await setup();
  const h = await hashPassword('Correct-Horse-7');
  await t.pool.query(`INSERT INTO admins (email, name, role, password_hash) VALUES ('owner@x.com','Ника','owner',$1),('staff@x.com','Диана','staff',$1)`, [h]);
  nika = await login('owner@x.com'); staff = await login('staff@x.com');
});
after(() => t.close());

test('новый админ экскурсию не видел; отметка сохраняется и видна с другого устройства', async () => {
  assert.equal((await me(nika)).tourDone, false);
  const r = await t.api('PUT', '/api/admin/tour', { done: true }, { cookie: nika });
  assert.equal(r.statusCode, 200);
  const other = await login('owner@x.com');            // «другое устройство» = новая сессия
  assert.equal((await me(other)).tourDone, true);
  assert.equal((await me(staff)).tourDone, false);     // у другого админа своя отметка
});

test('отметку можно снять, мусор не принимается, без входа нельзя', async () => {
  assert.equal((await t.api('PUT', '/api/admin/tour', { done: 'yes' }, { cookie: nika })).statusCode, 400);
  assert.equal((await t.api('PUT', '/api/admin/tour', { done: false }, { cookie: nika })).statusCode, 200);
  assert.equal((await me(nika)).tourDone, false);
  assert.equal((await t.api('PUT', '/api/admin/tour', { done: true })).statusCode, 401);
});
