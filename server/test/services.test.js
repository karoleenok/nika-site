// «Сервисы и оплаты»: доступ только owner/tech, проверка полей, правка срока, журнал.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf } from './helpers.js';
import { hashPassword } from '../src/auth/password.js';

let t, nika, staff;
const login = async (email) => {
  const r = await t.api('POST', '/api/auth/password', { email, password: 'Correct-Horse-7', kind: 'admin' }, { ip: t.freshIp() });
  return cookieOf(r, r.cookies[0].name).header;
};
const good = { name: 'Почта Postbox', what: 'Письма с сайта', sum: 120, period: 'month', until: '2027-01-10', payUrl: 'https://example.com/pay', payer: 'nika', autoRenew: false, note: '' };

before(async () => {
  t = await setup();
  const h = await hashPassword('Correct-Horse-7');
  await t.pool.query(`INSERT INTO admins (email, name, role, password_hash) VALUES ('owner@x.com','Ника','owner',$1),('staff@x.com','Диана','staff',$1)`, [h]);
  nika = await login('owner@x.com'); staff = await login('staff@x.com');
});
after(() => t.close());

test('сразу после миграции есть домен, сервер и хранилище', async () => {
  const r = await t.api('GET', '/api/admin/services', undefined, { cookie: nika });
  assert.equal(r.statusCode, 200);
  const names = r.json().services.map((s) => s.name);
  assert.deepEqual(names.sort(), ['Домен nikassd.ru', 'Сервер Timeweb', 'Хранилище Timeweb']);
  const srv = r.json().services.find((s) => s.name === 'Сервер Timeweb');
  assert.equal(srv.sum, 2140); assert.equal(srv.until, '2026-12-13');
});

test('Диана и гости раздел не видят', async () => {
  assert.equal((await t.api('GET', '/api/admin/services', undefined, { cookie: staff })).statusCode, 403);
  assert.equal((await t.api('POST', '/api/admin/services', good, { cookie: staff })).statusCode, 403);
  assert.equal((await t.api('GET', '/api/admin/services')).statusCode, 401);
});

test('создать, поменять срок, удалить: всё попадает в журнал', async () => {
  const c = await t.api('POST', '/api/admin/services', good, { cookie: nika });
  assert.equal(c.statusCode, 201);
  const id = c.json().service.id;
  const p = await t.api('PATCH', `/api/admin/services/${id}`, { until: '2027-02-10' }, { cookie: nika });
  assert.equal(p.statusCode, 200); assert.equal(p.json().service.until, '2027-02-10'); assert.equal(p.json().service.name, good.name);
  assert.equal((await t.api('DELETE', `/api/admin/services/${id}`, undefined, { cookie: nika })).statusCode, 200);
  assert.equal((await t.api('DELETE', `/api/admin/services/${id}`, undefined, { cookie: nika })).statusCode, 404);
  const acts = (await t.pool.query(`SELECT action FROM audit_log WHERE action LIKE 'service.%' ORDER BY id`)).rows.map((r) => r.action);
  assert.deepEqual(acts, ['service.create', 'service.update', 'service.delete']);
});

test('мусор в полях не принимается', async () => {
  const bad = async (patch) => (await t.api('POST', '/api/admin/services', { ...good, ...patch }, { cookie: nika })).statusCode;
  assert.equal(await bad({ name: '  ' }), 400);
  assert.equal(await bad({ sum: -5 }), 400);
  assert.equal(await bad({ sum: '12abc' }), 400);
  assert.equal(await bad({ period: 'week' }), 400);
  assert.equal(await bad({ until: '2027-02-30' }), 400);
  assert.equal(await bad({ until: 'завтра' }), 400);
  assert.equal(await bad({ payUrl: 'javascript:alert(1)' }), 400);
  assert.equal(await bad({ payUrl: 'http://example.com' }), 400);
  assert.equal(await bad({ payer: 'мама' }), 400);
  assert.equal(await bad({ autoRenew: 'yes' }), 400);
  const r = await t.api('PATCH', '/api/admin/services/abc', { note: 'x' }, { cookie: nika });
  assert.equal(r.statusCode, 404);
  const first = (await t.api('GET', '/api/admin/services', undefined, { cookie: nika })).json().services[0];
  assert.equal((await t.api('PATCH', `/api/admin/services/${first.id}`, {}, { cookie: nika })).statusCode, 400);
});

test('дату можно очистить: напоминаний по такому сервису нет', async () => {
  const first = (await t.api('GET', '/api/admin/services', undefined, { cookie: nika })).json().services[0];
  const r = await t.api('PATCH', `/api/admin/services/${first.id}`, { until: '' }, { cookie: nika });
  assert.equal(r.json().service.until, null);
});
