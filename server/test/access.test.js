import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf, codeFrom } from './helpers.js';
import { accessView, DAY } from '../src/access.js';

let t, T; // T — id тарифов по slug
before(async () => {
  t = await setup();
  await t.pool.query(`INSERT INTO admins (email, name, role) VALUES ('owner@x.com','Ника','owner'),('staff@x.com','Диана','staff'),('tech@x.com','Каролина','tech')`);
  await t.pool.query(`INSERT INTO tariffs (slug, kind, grp, name, price_kop, old_price_kop, access_days, sort) VALUES
    ('train-24h','access','Тренировки','24 часа',99900,249900,1,1),
    ('train-1m','access','Тренировки','1 месяц',999900,1279900,28,2),
    ('train-4m','access','Тренировки','4 месяца',3399900,4279900,112,3)`);
  await t.pool.query(`INSERT INTO tariffs (slug, kind, grp, name, price_kop, sort) VALUES ('food','service','Питание','Консультация',499900,9)`);
  T = Object.fromEntries((await t.pool.query('SELECT id, slug FROM tariffs')).rows.map((r) => [r.slug, String(r.id)]));
});
after(() => t.close());

async function adminLogin(email) {
  t.mails.length = 0;
  const ip = t.freshIp();
  await t.pool.query('DELETE FROM login_codes WHERE email = $1', [email]);
  await t.api('POST', '/api/auth/code', { email, kind: 'admin' }, { ip });
  const r = await t.api('POST', '/api/auth/verify', { email, code: codeFrom(t.mails.at(-1)), kind: 'admin', remember: true }, { ip });
  return cookieOf(r, 'nika_adm').header;
}
async function userLogin(email) {
  t.mails.length = 0;
  const ip = t.freshIp();
  await t.pool.query('DELETE FROM login_codes WHERE email = $1', [email]);
  await t.api('POST', '/api/auth/code', { email }, { ip });
  const r = await t.api('POST', '/api/auth/verify', { email, code: codeFrom(t.mails.at(-1)) , remember: true }, { ip });
  return cookieOf(r, 'nika_lk').header;
}
const newClient = async (cookie, email, name = 'Клиент') => {
  const r = await t.api('POST', '/api/admin/clients', { name, email }, { cookie });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id;
};
const get = async (cookie, id) => (await t.api('GET', `/api/admin/clients/${id}`, undefined, { cookie })).json().client;

// ---------- Расчёт статуса ----------
test('статус: идёт / скоро конец / закончился / закрыт / не было; короткий доступ не «жёлтый»', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const row = (o) => ({ tariff_name: '1 месяц', tariff_days: 28, ...o });
  const iso = (d) => new Date(now.getTime() + d * DAY).toISOString();
  assert.equal(accessView(row({ active_end: iso(20), chain_start: iso(-8) }), now).state, 'ok');
  assert.equal(accessView(row({ active_end: iso(6.5), chain_start: iso(-21) }), now).state, 'warn');
  assert.equal(accessView(row({ active_end: iso(6.5), chain_start: iso(-21) }), now).daysLeft, 7);
  assert.equal(accessView(row({ active_end: iso(0.5), chain_start: iso(-0.5), tariff_name: '24 часа', tariff_days: 1 }), now).state, 'ok');
  const gone = accessView(row({ last_end: iso(-5) }), now);
  assert.equal(gone.state, 'bad'); assert.equal(gone.closed, false); assert.equal(gone.daysAgo, 5);
  const closed = accessView(row({ last_end: iso(10), last_closed_at: iso(-2) }), now);
  assert.equal(closed.state, 'bad'); assert.equal(closed.closed, true); assert.equal(closed.daysAgo, 2);
  assert.equal(accessView({}, now).state, 'none');
  assert.equal(accessView(row({ active_end: iso(20), chain_start: iso(-8) }), now).plan.weeks, 4);
});

// ---------- Права ----------
test('права: без входа 401, клиент в админку не попадает, staff без цен и журнала', async () => {
  assert.equal((await t.api('GET', '/api/admin/clients')).statusCode, 401);
  await t.pool.query(`INSERT INTO users (email, name) VALUES ('plain@x.com','Обычный')`);
  const lk = await userLogin('plain@x.com');
  assert.equal((await t.api('GET', '/api/admin/clients', undefined, { cookie: lk })).statusCode, 401);
  assert.equal((await t.api('GET', '/api/me/access')).statusCode, 401);
  const staff = await adminLogin('staff@x.com');
  assert.equal((await t.api('GET', '/api/admin/clients', undefined, { cookie: staff })).statusCode, 200);
  assert.equal((await t.api('GET', '/api/admin/tariffs', undefined, { cookie: staff })).statusCode, 403);
  assert.equal((await t.api('PATCH', `/api/admin/tariffs/${T['train-1m']}`, { price: 1 }, { cookie: staff })).statusCode, 403);
  assert.equal((await t.api('GET', '/api/admin/log', undefined, { cookie: staff })).statusCode, 403);
  for (const who of ['owner@x.com', 'tech@x.com']) {
    const c = await adminLogin(who);
    assert.equal((await t.api('GET', '/api/admin/tariffs', undefined, { cookie: c })).statusCode, 200);
    assert.equal((await t.api('GET', '/api/admin/log', undefined, { cookie: c })).statusCode, 200);
  }
});

test('запрос с чужого сайта на изменение доступа отклоняется', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'csrf@x.com');
  const r = await t.api('POST', `/api/admin/clients/${id}/access`, { days: 7, tariffId: T['train-1m'] }, { cookie: c, headers: { origin: 'https://evil.example' } });
  assert.equal(r.statusCode, 403);
});

// ---------- Клиенты ----------
test('клиенты: создать, дубль почты 409, правка, плохая почта и телефон', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'Anna@X.com ', 'Анна');
  const dup = await t.api('POST', '/api/admin/clients', { name: 'Ещё', email: 'anna@x.com' }, { cookie: c });
  assert.equal(dup.statusCode, 409);
  assert.equal((await t.api('POST', '/api/admin/clients', { name: 'Ещё', email: 'нет' }, { cookie: c })).statusCode, 400);
  assert.equal((await t.api('POST', '/api/admin/clients', { name: '', email: 'q@x.com' }, { cookie: c })).statusCode, 400);
  const p = await t.api('PATCH', `/api/admin/clients/${id}`, { phone: '+7 914 163-66-65', note: 'колено' }, { cookie: c });
  assert.equal(p.statusCode, 200, p.body);
  const cl = await get(c, id);
  assert.equal(cl.email, 'anna@x.com'); assert.equal(cl.phone, '+7 914 163-66-65'); assert.equal(cl.note, 'колено'); assert.equal(cl.state, 'none');
  assert.equal((await t.api('PATCH', `/api/admin/clients/${id}`, { phone: 'abc' }, { cookie: c })).statusCode, 400);
  const other = await newClient(c, 'other@x.com');
  assert.equal((await t.api('PATCH', `/api/admin/clients/${other}`, { email: 'anna@x.com' }, { cookie: c })).statusCode, 409);
  assert.equal((await t.api('GET', '/api/admin/clients/abc', undefined, { cookie: c })).statusCode, 404);
});

test('смена почты клиента закрывает его сессии', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'move@x.com', 'Переезд');
  const lk = await userLogin('move@x.com');
  assert.equal((await t.api('GET', '/api/me', undefined, { cookie: lk })).statusCode, 200);
  await t.api('PATCH', `/api/admin/clients/${id}`, { email: 'moved@x.com' }, { cookie: c });
  assert.equal((await t.api('GET', '/api/me', undefined, { cookie: lk })).statusCode, 401);
});

// ---------- Сроки ----------
test('доступ: открыть с нуля нужен тариф; срок = дни × 24 часа от сейчас', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'open@x.com');
  assert.equal((await t.api('POST', `/api/admin/clients/${id}/access`, { days: 28 }, { cookie: c })).statusCode, 400, 'без тарифа нельзя');
  assert.equal((await t.api('POST', `/api/admin/clients/${id}/access`, { days: 28, tariffId: T.food }, { cookie: c })).statusCode, 400, 'услуга не даёт доступ');
  const before = Date.now();
  const r = await t.api('POST', `/api/admin/clients/${id}/access`, { days: 28, tariffId: T['train-1m'], note: 'оплата переводом' }, { cookie: c });
  assert.equal(r.statusCode, 200, r.body);
  const ends = new Date(r.json().endsAt).getTime();
  assert.ok(Math.abs(ends - (before + 28 * DAY)) < 5000);
  const cl = await get(c, id);
  assert.equal(cl.state, 'ok'); assert.equal(cl.plan.name, '1 месяц'); assert.equal(cl.plan.weeks, 4); assert.equal(cl.daysLeft, 28);
});

test('продление идёт от текущей даты окончания, а не от сегодня', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'ext@x.com');
  const a = (await t.api('POST', `/api/admin/clients/${id}/access`, { days: 28, tariffId: T['train-1m'] }, { cookie: c })).json().endsAt;
  const b = (await t.api('POST', `/api/admin/clients/${id}/access`, { days: 14 }, { cookie: c })).json().endsAt;
  assert.equal(new Date(b).getTime() - new Date(a).getTime(), 14 * DAY);
  const cl = await get(c, id);
  assert.equal(cl.plan.name, '1 месяц', 'тариф берётся из прошлого периода');
  assert.equal(cl.daysLeft, 42);
  const hist = (await t.api('GET', `/api/admin/clients/${id}`, undefined, { cookie: c })).json().history;
  assert.deepEqual(hist.map((h) => h.action), ['access.extend', 'access.open', 'client.create']);
});

test('продление закончившегося доступа считается от сегодня', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'old@x.com');
  await t.pool.query(`INSERT INTO access_periods (user_id, tariff_id, starts_at, ends_at, source)
    VALUES ($1, $2, now() - interval '40 days', now() - interval '12 days', 'manual')`, [id, T['train-1m']]);
  assert.equal((await get(c, id)).state, 'bad');
  const before = Date.now();
  const r = await t.api('POST', `/api/admin/clients/${id}/access`, { days: 7 }, { cookie: c });
  assert.ok(Math.abs(new Date(r.json().endsAt).getTime() - (before + 7 * DAY)) < 5000);
  assert.equal((await get(c, id)).state, 'warn');
});

test('защита от опечаток: срок 0, дробный, больше года, слишком далеко вперёд', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'typo@x.com');
  for (const days of [0, -5, 1.5, 400, 'abc', null]) {
    assert.equal((await t.api('POST', `/api/admin/clients/${id}/access`, { days, tariffId: T['train-1m'] }, { cookie: c })).statusCode, 400, String(days));
  }
  await t.api('POST', `/api/admin/clients/${id}/access`, { days: 366, tariffId: T['train-1m'] }, { cookie: c });
  await t.api('POST', `/api/admin/clients/${id}/access`, { days: 366, tariffId: T['train-1m'] }, { cookie: c });
  assert.equal((await t.api('POST', `/api/admin/clients/${id}/access`, { days: 366 }, { cookie: c })).statusCode, 400, 'больше 800 дней вперёд нельзя');
});

test('два одновременных продления не теряются и не дублируются', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'race@x.com');
  await t.api('POST', `/api/admin/clients/${id}/access`, { days: 28, tariffId: T['train-1m'] }, { cookie: c });
  const rs = await Promise.all([1, 2, 3].map(() => t.api('POST', `/api/admin/clients/${id}/access`, { days: 7 }, { cookie: c })));
  assert.ok(rs.every((r) => r.statusCode === 200));
  assert.equal((await get(c, id)).daysLeft, 28 + 21);
});

test('закрытие доступа: клиент закрыт, повторное закрытие 400, открыть снова — от сегодня', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'close@x.com');
  await t.api('POST', `/api/admin/clients/${id}/access`, { days: 28, tariffId: T['train-1m'] }, { cookie: c });
  const r = await t.api('POST', `/api/admin/clients/${id}/access/close`, { note: 'возврат денег' }, { cookie: c });
  assert.equal(r.statusCode, 200);
  const cl = await get(c, id);
  assert.equal(cl.state, 'bad'); assert.equal(cl.closed, true);
  assert.equal((await t.api('POST', `/api/admin/clients/${id}/access/close`, {}, { cookie: c })).statusCode, 400);
  const lk = await userLogin('close@x.com');
  const mine = (await t.api('GET', '/api/me/access', undefined, { cookie: lk })).json();
  assert.equal(mine.state, 'bad'); assert.equal(mine.closed, true);
  const before = Date.now();
  const open = await t.api('POST', `/api/admin/clients/${id}/access`, { days: 7 }, { cookie: c });
  assert.ok(Math.abs(new Date(open.json().endsAt).getTime() - (before + 7 * DAY)) < 5000, 'после закрытия считаем от сегодня');
  assert.equal((await get(c, id)).state, 'warn');
});

test('отмена продления: только последнее и свежее; прошлый срок возвращается', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'undo@x.com');
  const a = (await t.api('POST', `/api/admin/clients/${id}/access`, { days: 28, tariffId: T['train-1m'] }, { cookie: c })).json();
  const b = (await t.api('POST', `/api/admin/clients/${id}/access`, { days: 112 }, { cookie: c })).json();
  assert.equal((await t.api('POST', `/api/admin/clients/${id}/access/undo`, { periodId: a.periodId }, { cookie: c })).statusCode, 400, 'не последнее');
  assert.equal((await t.api('POST', `/api/admin/clients/${id}/access/undo`, { periodId: b.periodId }, { cookie: c })).statusCode, 200);
  assert.equal((await get(c, id)).daysLeft, 28);
  await t.pool.query(`UPDATE access_periods SET created_at = now() - interval '1 hour' WHERE id = $1`, [a.periodId]);
  assert.equal((await t.api('POST', `/api/admin/clients/${id}/access/undo`, { periodId: a.periodId }, { cookie: c })).statusCode, 400, 'старше 15 минут');
  const other = await newClient(c, 'undo2@x.com');
  assert.equal((await t.api('POST', `/api/admin/clients/${other}/access/undo`, { periodId: a.periodId }, { cookie: c })).statusCode, 400, 'чужой период');
  const paid = (await t.pool.query(`INSERT INTO access_periods (user_id, tariff_id, starts_at, ends_at, source) VALUES ($1,$2,now(),now()+interval '7 days','payment') RETURNING id`, [other, T['train-1m']])).rows[0].id;
  assert.equal((await t.api('POST', `/api/admin/clients/${other}/access/undo`, { periodId: String(paid) }, { cookie: c })).statusCode, 400, 'оплату так не отменить');
});

// ---------- Кабинет клиента ----------
test('«Мой доступ»: клиент видит только свой срок; без доступа — none', async () => {
  const c = await adminLogin('owner@x.com');
  const a = await newClient(c, 'mine@x.com', 'Моя');
  await newClient(c, 'notmine@x.com', 'Чужая');
  await t.api('POST', `/api/admin/clients/${a}/access`, { days: 56, tariffId: T['train-4m'] }, { cookie: c });
  const lk = await userLogin('mine@x.com');
  const me = (await t.api('GET', '/api/me/access', undefined, { cookie: lk })).json();
  assert.equal(me.state, 'ok'); assert.equal(me.daysLeft, 56); assert.equal(me.plan.name, '4 месяца'); assert.equal(me.spanDays, 56);
  assert.ok(!('note' in me) && !('email' in me));
  const lk2 = await userLogin('notmine@x.com');
  assert.equal((await t.api('GET', '/api/me/access', undefined, { cookie: lk2 })).json().state, 'none');
});

test('«Мой доступ»: оплаты клиента — только его и только оплаченные', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'pay@x.com', 'Плательщик');
  const other = await newClient(c, 'pay2@x.com', 'Другая');
  await t.pool.query(`INSERT INTO orders (user_id, email, tariff_id, item_name, amount_kop, status, paid_at) VALUES
    ($1,'pay@x.com',$3,'Тариф «1 месяц»',999900,'paid',now()),
    ($1,'pay@x.com',$3,'Не оплачен',999900,'new',NULL),
    ($2,'pay2@x.com',$3,'Чужая оплата',100,'paid',now())`, [id, other, T['train-1m']]);
  const lk = await userLogin('pay@x.com');
  const mine = (await t.api('GET', '/api/me/access', undefined, { cookie: lk })).json();
  assert.deepEqual(mine.payments.map((p) => p.title), ['Тариф «1 месяц»']);
  const pur = (await t.api('GET', '/api/admin/purchases', undefined, { cookie: c })).json().purchases;
  assert.ok(pur.some((p) => p.title === 'Тариф «1 месяц»') && !pur.some((p) => p.title === 'Не оплачен'));
});

// ---------- Цены ----------
test('цены: правка в рублях, старая цена выше новой, публичный список с сервера', async () => {
  const c = await adminLogin('tech@x.com');
  const id = T['train-1m'];
  assert.equal((await t.api('PATCH', `/api/admin/tariffs/${id}`, { price: 0 }, { cookie: c })).statusCode, 400);
  assert.equal((await t.api('PATCH', `/api/admin/tariffs/${id}`, { price: 'abc' }, { cookie: c })).statusCode, 400);
  assert.equal((await t.api('PATCH', `/api/admin/tariffs/${id}`, { price: 9999, old: 9000 }, { cookie: c })).statusCode, 400);
  assert.equal((await t.api('PATCH', `/api/admin/tariffs/${id}`, { price: 10500, old: 12800 }, { cookie: c })).statusCode, 200);
  const pub = (await t.api('GET', '/api/tariffs')).json().tariffs.find((x) => x.slug === 'train-1m');
  assert.equal(pub.price, 10500); assert.equal(pub.old, 12800); assert.equal(pub.weeks, 4);
  assert.equal((await t.pool.query('SELECT price_kop FROM tariffs WHERE id = $1', [id])).rows[0].price_kop, 1050000);
  await t.api('PATCH', `/api/admin/tariffs/${id}`, { price: 9999, old: 0 }, { cookie: c });
  assert.equal((await t.api('GET', '/api/tariffs')).json().tariffs.find((x) => x.slug === 'train-1m').old, 0);
});

// ---------- Журнал ----------
test('журнал: кто и что; входы скрыты; имя клиента подтягивается; без привязки к клиенту после удаления', async () => {
  const c = await adminLogin('owner@x.com');
  const id = await newClient(c, 'log@x.com', 'Для журнала');
  await t.api('POST', `/api/admin/clients/${id}/access`, { days: 7, tariffId: T['train-1m'], note: 'тест' }, { cookie: c });
  await t.api('POST', `/api/admin/clients/${id}/remind`, {}, { cookie: c });
  const log = (await t.api('GET', '/api/admin/log', undefined, { cookie: c })).json().log;
  assert.ok(!log.some((x) => x.action === 'login'));
  const e = log.find((x) => x.action === 'access.open' && x.clientId === id);
  assert.equal(e.who, 'Ника'); assert.equal(e.client, 'Для журнала'); assert.equal(e.note, 'тест');
  assert.equal((await get(c, id)).reminded, true);
  await t.pool.query('DELETE FROM users WHERE id = $1', [id]);
  const after = (await t.api('GET', '/api/admin/log', undefined, { cookie: c })).json().log.find((x) => x.id === e.id);
  assert.equal(after.clientId, null); assert.equal(after.client, null);
});
