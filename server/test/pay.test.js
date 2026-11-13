import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf, codeFrom } from './helpers.js';
import { paymentUrl, sumToKop, kopToSum, signResult, receiptFor } from '../src/pay/robokassa.js';
import crypto from 'node:crypto';

let t, rk;
before(async () => {
  t = await setup();
  rk = t.config.robokassa;
  await t.pool.query(`INSERT INTO admins (email, name, role) VALUES ('owner@x.com','Ника','owner'),('staff@x.com','Диана','staff')`);
  await t.pool.query(`INSERT INTO tariffs (slug, kind, grp, name, price_kop, access_days, sort) VALUES ('train-1m','access','Тренировки','Тренировки онлайн, 1 месяц',999900,28,1)`);
  await t.pool.query(`INSERT INTO tariffs (slug, kind, grp, name, price_kop, sort) VALUES
    ('guide','material','Материалы','Гайд',89900,2), ('food','service','Питание','Консультация',499900,3)`);
  await t.pool.query(`INSERT INTO tariffs (slug, kind, grp, name, price_kop, sort, active) VALUES ('old','service','x','Снято',100,4,false)`);
});
after(() => t.close());

const start = (item, email = 'buyer@x.com', extra = {}) =>
  t.api('POST', '/api/pay/start', { item, email, consent: true, agree: true, ...extra }, { ip: t.freshIp() });
// Уведомление так, как его шлёт Robokassa: форма, без Origin
const notify = (fields) => t.app.inject({ method: 'POST', url: '/api/pay/result', remoteAddress: '185.59.216.65',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString() });
const paid = (id, sum) => notify({ OutSum: sum, InvId: id, SignatureValue: signResult(rk, sum, id).toUpperCase(), Fee: '389.96', IncCurrLabel: 'BankCard' });
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

async function adminLogin(email) {
  t.mails.length = 0; const ip = t.freshIp();
  await t.api('POST', '/api/auth/code', { email, kind: 'admin' }, { ip });
  const r = await t.api('POST', '/api/auth/verify', { email, code: codeFrom(t.mails.at(-1)), kind: 'admin', remember: true }, { ip });
  return cookieOf(r, 'nika_adm').header;
}

test('суммы: копейки ↔ строка Robokassa без float-ошибок', () => {
  assert.equal(kopToSum(999900), '9999.00');
  assert.equal(kopToSum(5), '0.05');
  assert.equal(sumToKop('9999.000000'), 999900);
  assert.equal(sumToKop('9999'), 999900);
  assert.equal(sumToKop('0.05'), 5);
  assert.equal(sumToKop('9999.001'), null);
  assert.equal(sumToKop('-1'), null);
  assert.equal(sumToKop('1e5'), null);
});

test('ссылка на оплату: подпись по формуле из документации, чек самозанятого, тестовый режим', () => {
  const url = new URL(paymentUrl(rk, { invId: 7, kop: 999900, description: 'Тренировки', name: 'Тренировки', email: 'a@b.ru' }));
  const q = url.searchParams;
  assert.equal(url.origin + url.pathname, 'https://auth.robokassa.ru/Merchant/Index.aspx');
  assert.equal(q.get('OutSum'), '9999.00');
  assert.equal(q.get('IsTest'), '1');
  const receipt = q.get('Receipt');                       // после одного раскодирования — URL-кодированный JSON
  assert.deepEqual(JSON.parse(decodeURIComponent(receipt)), receiptFor({ name: 'Тренировки', kop: 999900 }));
  assert.equal(q.get('SignatureValue'), md5(`${rk.login}:9999.00:7:${receipt}:${rk.password1}`));
  const item = JSON.parse(decodeURIComponent(receipt)).items[0];
  assert.deepEqual([item.tax, item.payment_method, item.payment_object, item.quantity, item.sum], ['none', 'full_payment', 'service', 1, 9999]);
  assert.ok(receiptFor({ name: 'x'.repeat(300), kop: 1 }).items[0].name.length <= 128);
});

test('старт: цена только из базы, нужны согласия, нет неактивных товаров, отклоняется чужой сайт', async () => {
  let r = await start('train-1m', 'buyer@x.com', { price: 1 });
  assert.equal(r.statusCode, 200);
  const o = (await t.pool.query('SELECT amount_kop, item_name, consent_at, offer_version, test FROM orders WHERE id = $1', [r.json().orderId])).rows[0];
  assert.equal(o.amount_kop, 999900);
  assert.ok(o.consent_at && o.offer_version && o.test);
  assert.equal(new URL(r.json().url).searchParams.get('OutSum'), '9999.00');
  assert.equal((await start('train-1m', 'buyer@x.com', { consent: false })).statusCode, 400);
  assert.equal((await start('train-1m', 'плохая')).statusCode, 400);
  assert.equal((await start('old')).statusCode, 404);
  assert.equal((await start('нет-такого')).statusCode, 404);
  r = await t.app.inject({ method: 'POST', url: '/api/pay/start', payload: { item: 'train-1m', email: 'a@b.ru', consent: true, agree: true }, headers: { origin: 'https://evil.example' } });
  assert.equal(r.statusCode, 403);
});

test('оплата доступа: подпись, сумма, OK{InvId}, доступ на 4 недели, письма, журнал; повтор не продлевает дважды', async () => {
  const s = (await start('train-1m', 'new@x.com')).json();
  let st = await t.api('GET', `/api/pay/status/${s.orderId}?k=${s.key}`);
  assert.equal(st.json().status, 'new');
  assert.equal((await t.api('GET', `/api/pay/status/${s.orderId}?k=wrong`)).statusCode, 404);

  // подделки
  assert.equal((await notify({ OutSum: '9999.00', InvId: s.orderId, SignatureValue: 'abc' })).statusCode, 400);
  assert.equal((await paid(s.orderId, '1.00')).statusCode, 400);                // подпись верна, сумма нет
  assert.equal((await paid('999999', '9999.00')).statusCode, 400);              // нет такого заказа
  assert.equal((await t.pool.query(`SELECT count(*)::int n FROM access_periods`)).rows[0].n, 0);

  t.mails.length = 0;
  const r = await paid(s.orderId, '9999.000000');
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, `OK${s.orderId}`);
  const p = (await t.pool.query(`SELECT p.*, u.email FROM access_periods p JOIN users u ON u.id = p.user_id`)).rows;
  assert.equal(p.length, 1);
  assert.equal(p[0].source, 'payment');
  assert.ok(Math.abs(new Date(p[0].ends_at) - Date.now() - 28 * 864e5) < 60e3);
  const o = (await t.pool.query('SELECT status, paid_at, fee_kop, pay_method FROM orders WHERE id = $1', [s.orderId])).rows[0];
  assert.deepEqual([o.status, o.fee_kop, o.pay_method], ['paid', 38996, 'BankCard']);
  await new Promise((res) => setImmediate(res));
  assert.ok(t.mails.some((m) => m.to === 'new@x.com' && /Оплата прошла/.test(m.subject)));
  assert.ok(t.mails.some((m) => m.to === t.config.smtp.adminNotify && /Оплата/.test(m.subject)));
  assert.equal((await t.pool.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.paid'`)).rows[0].n, 1);

  // повтор и одновременные повторы
  const again = await Promise.all([paid(s.orderId, '9999.00'), paid(s.orderId, '9999.00'), paid(s.orderId, '9999.00')]);
  assert.ok(again.every((x) => x.statusCode === 200 && x.body === `OK${s.orderId}`));
  assert.equal((await t.pool.query(`SELECT count(*)::int n FROM access_periods`)).rows[0].n, 1);
  st = await t.api('GET', `/api/pay/status/${s.orderId}?k=${s.key}`);
  assert.equal(st.json().status, 'paid');
  const ev = (await t.pool.query(`SELECT result, count(*)::int n FROM payment_events GROUP BY result`)).rows;
  assert.deepEqual(Object.fromEntries(ev.map((e) => [e.result, e.n])), { bad_sign: 1, bad_sum: 1, bad_order: 1, paid: 1, repeat: 3 });
});

test('вторая оплата продлевает от текущей даты окончания; GET-уведомление тоже принимается', async () => {
  const before = (await t.pool.query(`SELECT max(ends_at) e FROM access_periods p JOIN users u ON u.id = p.user_id WHERE u.email = 'new@x.com'`)).rows[0].e;
  const s = (await start('train-1m', 'new@x.com')).json();
  const r = await t.app.inject({ method: 'GET', url: `/api/pay/result?OutSum=9999.00&InvId=${s.orderId}&SignatureValue=${signResult(rk, '9999.00', s.orderId)}` });
  assert.equal(r.body, `OK${s.orderId}`);
  const after = (await t.pool.query(`SELECT max(ends_at) e FROM access_periods p JOIN users u ON u.id = p.user_id WHERE u.email = 'new@x.com'`)).rows[0].e;
  assert.equal(new Date(after) - new Date(before), 28 * 864e5);
});

test('материал попадает в покупки, услуга только уведомляет', async () => {
  const g = (await start('guide', 'm@x.com')).json();
  await paid(g.orderId, '899.00');
  assert.equal((await t.pool.query(`SELECT count(*)::int n FROM purchases WHERE order_id = $1`, [g.orderId])).rows[0].n, 1);
  const f = (await start('food', 'm@x.com')).json();
  assert.equal((await paid(f.orderId, '4999.00')).body, `OK${f.orderId}`);
  assert.equal((await t.pool.query(`SELECT count(*)::int n FROM access_periods p JOIN users u ON u.id = p.user_id WHERE u.email = 'm@x.com'`)).rows[0].n, 0);
});

test('админка: только owner/tech; ручное подтверждение с заметкой; возврат закрывает доступ и сдвигает продления', async () => {
  const staff = await adminLogin('staff@x.com');
  assert.equal((await t.api('GET', '/api/admin/orders', undefined, { cookie: staff })).statusCode, 403);
  const own = await adminLogin('owner@x.com');

  const a = (await start('train-1m', 'r@x.com')).json();
  assert.equal((await t.api('POST', `/api/admin/orders/${a.orderId}/confirm`, { note: '' }, { cookie: own })).statusCode, 400);
  assert.equal((await t.api('POST', `/api/admin/orders/${a.orderId}/confirm`, { note: 'оплата есть в кабинете' }, { cookie: own })).statusCode, 200);
  assert.equal((await t.api('POST', `/api/admin/orders/${a.orderId}/confirm`, { note: 'ещё раз' }, { cookie: own })).statusCode, 400);
  // уведомление, пришедшее после ручного подтверждения, ничего не добавляет
  assert.equal((await paid(a.orderId, '9999.00')).body, `OK${a.orderId}`);
  const b = (await start('train-1m', 'r@x.com')).json();
  await paid(b.orderId, '9999.00');
  const q = `SELECT max(ends_at) e FROM access_periods p JOIN users u ON u.id = p.user_id WHERE u.email = 'r@x.com' AND closed_at IS NULL`;
  const end2 = new Date((await t.pool.query(q)).rows[0].e);
  assert.ok(Math.abs(end2 - Date.now() - 56 * 864e5) < 60e3);

  // возврат первого заказа: остаётся 4 недели от сегодня, а не 8
  assert.equal((await t.api('POST', `/api/admin/orders/${a.orderId}/refund`, { note: '' }, { cookie: own })).statusCode, 400);
  assert.equal((await t.api('POST', `/api/admin/orders/${a.orderId}/refund`, { note: 'передумала' }, { cookie: own })).statusCode, 200);
  const end1 = new Date((await t.pool.query(q)).rows[0].e);
  assert.ok(Math.abs(end1 - Date.now() - 28 * 864e5) < 60e3);
  assert.equal((await t.api('POST', `/api/admin/orders/${a.orderId}/refund`, { note: 'ещё' }, { cookie: own })).statusCode, 400);
  const list = (await t.api('GET', '/api/admin/orders', undefined, { cookie: own })).json().orders;
  const ra = list.find((o) => o.id === a.orderId);
  assert.deepEqual([ra.status, ra.note, ra.who], ['refunded', 'передумала', 'Ника']);
  const log = (await t.pool.query(`SELECT action FROM audit_log WHERE target = $1 ORDER BY id`, [a.orderId])).rows.map((r) => r.action);
  assert.deepEqual(log, ['order.manual', 'order.refund']);
});
