import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf } from './helpers.js';
import { hashPassword } from '../src/auth/password.js';

// «Выдать доступ» одним шагом: клиент оплатил через WhatsApp, почты может не быть
let t, admin, tariffId;
const ck = (r) => cookieOf(r, r.cookies[0].name).header;
before(async () => {
  t = await setup();
  await t.pool.query(`INSERT INTO admins (email, name, role, password_hash) VALUES ('owner@x.com','Ника','owner',$1)`, [await hashPassword('Correct-Horse-7')]);
  admin = ck(await t.api('POST', '/api/auth/password', { email: 'owner@x.com', password: 'Correct-Horse-7', kind: 'admin' }, { ip: t.freshIp() }));
  tariffId = String((await t.pool.query(`INSERT INTO tariffs (slug, kind, grp, name, price_kop, access_days, sort) VALUES ('m1','access','Доступ','Месяц',300000,28,1) RETURNING id`)).rows[0].id);
});
after(() => t.close());

const grant = (body, cookie = admin) => t.api('POST', '/api/admin/clients/grant', body, { cookie: cookie || undefined });
const signIn = (login, password) => t.api('POST', '/api/auth/password', { email: login, password }, { ip: t.freshIp() });

test('без входа в админку не работает', async () => {
  assert.equal((await grant({ name: 'X', phone: '+79990000000', tariffId, days: 28 }, null)).statusCode, 401);
});

test('только телефон: клиент создан, доступ открыт, вход по номеру в любом виде, письма не уходят', async () => {
  t.mails.length = 0;
  const r = await grant({ name: 'Маша Петрова', phone: '8 (914) 123-45-67', tariffId, days: 28 });
  assert.equal(r.statusCode, 201);
  assert.equal(r.headers['cache-control'], 'no-store');
  const { id, login, password, endsAt, mustChange } = r.json();
  assert.equal(login, '+79141234567'); assert.equal(mustChange, true);
  assert.ok(new Date(endsAt) - Date.now() > 27 * 864e5);

  const card = (await t.api('GET', `/api/admin/clients/${id}`, undefined, { cookie: admin })).json();
  assert.equal(card.client.email, ''); assert.equal(card.client.login, '+79141234567');
  assert.equal(card.client.hasPassword, true); assert.equal(card.client.state, 'ok');
  const log = (await t.pool.query('SELECT action, meta FROM audit_log WHERE user_id = $1 ORDER BY id', [id])).rows;
  assert.deepEqual(log.map((l) => l.action), ['client.create', 'access.open', 'client.password']);
  assert.ok(!JSON.stringify(log).includes(password));

  for (const v of ['+79141234567', '89141234567', '+7 914 123 45 67']) assert.equal((await signIn(v, password)).statusCode, 200, v);
  assert.equal((await signIn('+79141234567', 'wrong-pass-123')).statusCode, 400);
  const me = (await t.api('GET', '/api/me', undefined, { cookie: ck(await signIn('+79141234567', password)) })).json();
  assert.equal(me.email, ''); assert.equal(me.login, '+79141234567'); assert.equal(me.shownPassword, password);
  assert.equal(t.mails.length, 0);
});

test('с почтой: логин — почта', async () => {
  const r = await grant({ name: 'Оля', phone: '+7 924 000-11-22', email: 'Olya@Example.com', tariffId, days: 7 });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().login, 'olya@example.com');
  assert.equal((await signIn('olya@example.com', r.json().password)).statusCode, 200);
});

test('дубль по телефону или почте: 409 и id карточки', async () => {
  const a = await grant({ name: 'Маша 2', phone: '+7 914 123 45 67', tariffId, days: 28 });
  assert.equal(a.statusCode, 409); assert.ok(a.json().id);
  const b = await grant({ name: 'Оля 2', phone: '', email: 'olya@example.com', tariffId, days: 28 });
  assert.equal(b.statusCode, 409);
});

test('проверки ввода', async () => {
  assert.equal((await grant({ name: '', phone: '+79990000001', tariffId, days: 28 })).statusCode, 400);
  assert.equal((await grant({ name: 'Без всего', phone: '', tariffId, days: 28 })).statusCode, 400);
  assert.equal((await grant({ name: 'Срок', phone: '+79990000002', tariffId, days: 0 })).statusCode, 400);
  assert.equal((await grant({ name: 'Тариф', phone: '+79990000003', tariffId: '999999', days: 28 })).statusCode, 400);
  assert.equal((await grant({ name: 'Почта', phone: '', email: 'not-mail', tariffId, days: 28 })).statusCode, 400);
});

test('смена телефона меняет логин; админ по телефону не входит', async () => {
  const r = await grant({ name: 'Катя', phone: '+79145550000', tariffId, days: 28 });
  const { id, password } = r.json();
  assert.equal((await t.api('PATCH', `/api/admin/clients/${id}`, { name: 'Катя', phone: '+79145550001' }, { cookie: admin })).statusCode, 200);
  assert.equal((await signIn('+79145550001', password)).statusCode, 200);
  assert.equal((await signIn('+79145550000', password)).statusCode, 400);
  assert.equal((await t.api('PATCH', `/api/admin/clients/${id}`, { name: 'Катя', phone: '' }, { cookie: admin })).statusCode, 400);
  assert.equal((await t.api('POST', '/api/auth/password', { email: '+79145550001', password, kind: 'admin' }, { ip: t.freshIp() })).statusCode, 400);
});
