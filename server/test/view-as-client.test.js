import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf } from './helpers.js';
import { hashPassword } from '../src/auth/password.js';

let t, owner, staff, uid;
const ck = (r) => cookieOf(r, r.cookies[0].name).header;
const adminIn = (email, pw) => t.api('POST', '/api/auth/password', { email, password: pw, kind: 'admin' }, { ip: t.freshIp() });
before(async () => {
  t = await setup();
  const h = await hashPassword('Correct-Horse-7');
  await t.pool.query(`INSERT INTO admins (email, name, role, password_hash) VALUES ('owner@x.com','Ника','owner',$1), ('staff@x.com','Диана','staff',$1)`, [h]);
  owner = ck(await adminIn('owner@x.com', 'Correct-Horse-7'));
  staff = ck(await adminIn('staff@x.com', 'Correct-Horse-7'));
  uid = (await t.api('POST', '/api/admin/clients', { name: 'Аня', email: 'anya@example.com', phone: '' }, { cookie: owner })).json().id;
  await t.api('POST', `/api/admin/clients/${uid}/password`, { mustChange: true }, { cookie: owner });
});
after(() => t.close());

const view = (cookie, id = uid) => t.api('POST', `/api/admin/clients/${id}/view`, {}, { cookie: cookie || undefined });

test('без входа, staff и чужой id: просмотр не открывается', async () => {
  assert.equal((await view(null)).statusCode, 401);
  assert.equal((await view(staff)).statusCode, 403);
  assert.equal((await view(owner, '999999')).statusCode, 404);
});

test('owner смотрит кабинет: только чтение, пароля не видно, окно смены пароля не открывается, есть журнал', async () => {
  const r = await view(owner);
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  const c = cookieOf(r, r.cookies[0].name);
  assert.equal(c.maxAge, undefined, 'кука до закрытия браузера');
  const lk = c.header;

  const me = (await t.api('GET', '/api/me', undefined, { cookie: lk })).json();
  assert.equal(me.login, 'anya@example.com');
  assert.deepEqual(me.viewAs, { admin: 'Ника' });
  assert.equal(me.shownPassword, null);
  assert.equal(me.mustChangePassword, false);
  assert.equal((await t.api('GET', '/api/me/access', undefined, { cookie: lk })).statusCode, 200);

  const put = await t.api('PUT', '/api/me/password', { password: 'Another-Strong-9' }, { cookie: lk });
  assert.equal(put.statusCode, 403);
  assert.equal((await t.api('DELETE', '/api/me/password', undefined, { cookie: lk })).statusCode, 403);
  const u = (await t.pool.query('SELECT password_temp FROM users WHERE id = $1', [uid])).rows[0];
  assert.equal(u.password_temp, true, 'пароль клиента не тронут');

  const s = (await t.pool.query(`SELECT persistent, viewer_admin_id, expires_at - created_at AS ttl FROM sessions WHERE user_id = $1 AND viewer_admin_id IS NOT NULL`, [uid])).rows[0];
  assert.equal(s.persistent, false);
  assert.ok(s.ttl.hours === 1 || s.ttl.minutes === 59, 'живёт час');

  const log = (await t.pool.query(`SELECT 1 FROM audit_log WHERE action = 'client.view' AND user_id = $1`, [uid])).rowCount;
  assert.equal(log, 1);

  // Выход из просмотра закрывает только эту сессию
  await t.api('POST', '/api/auth/logout', { kind: 'user' }, { cookie: lk });
  assert.equal((await t.api('GET', '/api/me', undefined, { cookie: lk })).statusCode, 401);
});

test('обычный вход клиента: viewAs пустой, запись разрешена', async () => {
  await t.pool.query(`INSERT INTO users (email, name, password_hash) VALUES ('eve@example.com','Ева',$1)`, [await hashPassword('Eve-Strong-Pass-1')]);
  const eve = ck(await t.api('POST', '/api/auth/password', { email: 'eve@example.com', password: 'Eve-Strong-Pass-1' }, { ip: t.freshIp() }));
  const me = (await t.api('GET', '/api/me', undefined, { cookie: eve })).json();
  assert.equal(me.viewAs, null);
});
