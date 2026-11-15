// Режим «почта ещё не работает»: клиент входит только по почте и паролю, который выдала Ника.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf } from './helpers.js';
import { hashPassword } from '../src/auth/password.js';

let t, admin;
const ck = (r) => cookieOf(r, r.cookies[0].name).header;
before(async () => {
  t = await setup({ MAIL_ENABLED: '0' });
  await t.pool.query(`INSERT INTO admins (email, name, role, password_hash) VALUES ('owner@x.com','Ника','owner',$1)`, [await hashPassword('Correct-Horse-7')]);
  admin = ck(await t.api('POST', '/api/auth/password', { email: 'owner@x.com', password: 'Correct-Horse-7', kind: 'admin' }, { ip: t.freshIp() }));
});
after(() => t.close());

test('без почты: весь путь клиента от карточки в админке до кабинета, ни одного письма для входа не нужно', async () => {
  assert.deepEqual((await t.api('GET', '/api/auth/config')).json(), { mail: false });
  const id = (await t.api('POST', '/api/admin/clients', { name: 'Оля', email: 'olya@example.com', phone: '' }, { cookie: admin })).json().id;
  const { password } = (await t.api('POST', `/api/admin/clients/${id}/password`, { mustChange: true }, { cookie: admin })).json();
  const c = ck(await t.api('POST', '/api/auth/password', { email: 'olya@example.com', password }, { ip: t.freshIp() }));
  const me = (await t.api('GET', '/api/me', undefined, { cookie: c })).json();
  assert.equal(me.mustChangePassword, true); assert.equal(me.passwordOnly, true);
  assert.equal((await t.api('PUT', '/api/me/password', { password: 'Оля любит море 5' }, { cookie: c })).statusCode, 200);
  assert.equal((await t.api('GET', '/api/me/access', undefined, { cookie: c })).statusCode, 200);
});

test('без почты пароль нельзя убрать: иначе клиент не вернётся в кабинет', async () => {
  const c = ck(await t.api('POST', '/api/auth/password', { email: 'olya@example.com', password: 'Оля любит море 5' }, { ip: t.freshIp() }));
  const r = await t.api('DELETE', '/api/me/password', undefined, { cookie: c });
  assert.equal(r.statusCode, 400);
  assert.equal((await t.api('POST', '/api/auth/password', { email: 'olya@example.com', password: 'Оля любит море 5' }, { ip: t.freshIp() })).statusCode, 200);
});
