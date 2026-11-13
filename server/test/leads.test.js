import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf, codeFrom } from './helpers.js';
import { normPhone } from '../src/leads/routes.js';
import { cleanAnswers, analysesFor, VERSION } from '../src/leads/quiz.js';

let t;
before(async () => {
  t = await setup();
  await t.pool.query(`INSERT INTO admins (email, name, role) VALUES ('owner@x.com','Ника','owner'),('tech@x.com','Каролина','tech'),('staff@x.com','Диана','staff')`);
});
after(() => t.close());

const lead = (extra = {}, ip = t.freshIp()) => t.api('POST', '/api/leads',
  { name: 'Кристина', phone: '8 (914) 123-45-67', service: 'test', consent: true, agree: true, ms: 9000, ...extra }, { ip });
const ANS = { symptoms: ['tired', 'hair'], food: 'veg', sun: 'rare', last: 'long', note: 'почта a@b.ru' };
const quiz = (key, extra = {}) => t.api('POST', '/api/quiz', { key, version: VERSION, healthConsent: true, answers: ANS, ...extra }, { ip: t.freshIp() });

async function adminLogin(email) {
  t.mails.length = 0; const ip = t.freshIp();
  await t.api('POST', '/api/auth/code', { email, kind: 'admin' }, { ip });
  const r = await t.api('POST', '/api/auth/verify', { email, code: codeFrom(t.mails.at(-1)), kind: 'admin', remember: true }, { ip });
  return cookieOf(r, 'nika_adm').header;
}

test('телефон приводится к +7…', () => {
  assert.equal(normPhone('8 (914) 123-45-67'), '+79141234567');
  assert.equal(normPhone('9141234567'), '+79141234567');
  assert.equal(normPhone('+7 914 123 45 67'), '+79141234567');
  assert.equal(normPhone('12345'), null);
});

test('ответы анкеты: только известные вопросы и варианты', () => {
  assert.ok(cleanAnswers(ANS));
  assert.equal(cleanAnswers({ ...ANS, extra: 1 }), null);
  assert.equal(cleanAnswers({ ...ANS, food: 'pizza' }), null);
  assert.equal(cleanAnswers({ ...ANS, symptoms: [] }), null);
  assert.equal(cleanAnswers({ ...ANS, symptoms: ['none', 'tired'] }), null);
  assert.equal(cleanAnswers({ ...ANS, note: 'x'.repeat(900) }).note.length, 500);
  const a = analysesFor(cleanAnswers(ANS));
  assert.ok(a.includes('cbc') && a.includes('ferritin') && a.includes('vitd') && a.includes('zinc'));
  assert.ok(!a.includes('glucose'));
});

test('заявка: без галочек и с плохим номером — отказ', async () => {
  assert.equal((await lead({ consent: false })).statusCode, 400);
  assert.equal((await lead({ phone: '123' })).statusCode, 400);
  assert.equal((await lead({ service: 'hack' })).statusCode, 400);
});

test('боты: скрытое поле и слишком быстрая отправка — ответ «ок», в базе пусто', async () => {
  const before = (await t.pool.query('SELECT count(*)::int n FROM leads')).rows[0].n;
  assert.equal((await lead({ website: 'http://spam' })).statusCode, 200);
  assert.equal((await lead({ ms: 300 })).statusCode, 200);
  assert.equal((await lead({ ms: undefined })).statusCode, 200);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM leads')).rows[0].n, before);
});

test('лимит: шестая заявка с одного адреса за 15 минут — 429', async () => {
  const ip = t.freshIp();
  for (let i = 0; i < 5; i++) assert.equal((await lead({ phone: '+7914000000' + i, service: 'food' }, ip)).statusCode, 200);
  assert.equal((await lead({ phone: '+79140000099', service: 'food' }, ip)).statusCode, 429);
});

test('запрос с чужого сайта не принимается', async () => {
  const r = await t.app.inject({ method: 'POST', url: '/api/leads', headers: { origin: 'https://evil.example' },
    payload: { name: 'a', phone: '+79140000000', service: 'food', consent: true, agree: true, ms: 9000 } });
  assert.equal(r.statusCode, 403);
});

test('тест: заявка → анкета → видна только owner, просмотр в журнале', async () => {
  t.mails.length = 0;
  const r = await lead({ phone: '+79145550001' });
  assert.equal(r.statusCode, 200);
  const key = r.json().quizKey;
  assert.ok(key);
  // Письмо Нике без телефона
  assert.equal(t.mails.length, 1);
  assert.ok(!t.mails[0].text.includes('5550001'));

  assert.equal((await quiz(key, { healthConsent: false })).statusCode, 400);
  assert.equal((await quiz(key, { version: 'old' })).statusCode, 409);
  assert.equal((await quiz(key)).statusCode, 200);
  // Ключ одноразовый: повтор отвечает так же, но второй анкеты нет
  assert.equal((await quiz(key)).statusCode, 200);
  assert.equal((await quiz('wrong-key')).statusCode, 200);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM questionnaires')).rows[0].n, 1);
  const row = (await t.pool.query('SELECT consent_at, consent_version, form_version FROM questionnaires')).rows[0];
  assert.ok(row.consent_at && row.consent_version && row.form_version === VERSION);

  const staff = await adminLogin('staff@x.com');
  const tech = await adminLogin('tech@x.com');
  const own = await adminLogin('owner@x.com');
  const list = (await t.api('GET', '/api/admin/leads', null, { cookie: staff })).json();
  const l = list.leads.find((x) => x.phone === '+79145550001');
  assert.equal(l.quiz, 'done');
  assert.equal(list.canQuiz, false);
  assert.equal((await t.api('GET', `/api/admin/leads/${l.id}/quiz`, null, { cookie: staff })).statusCode, 403);
  assert.equal((await t.api('GET', `/api/admin/leads/${l.id}/quiz`, null, { cookie: tech })).statusCode, 403);
  const q = await t.api('GET', `/api/admin/leads/${l.id}/quiz`, null, { cookie: own });
  assert.equal(q.statusCode, 200);
  assert.ok(q.json().analyses.includes('ферритин'));
  assert.equal((await t.pool.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'lead.quiz_view'`)).rows[0].n, 1);
  // Без входа — 401
  assert.equal((await t.api('GET', '/api/admin/leads')).statusCode, 401);
});

test('повтор с тем же номером не плодит заявки; обработать и удалить', async () => {
  const ip = t.freshIp();
  await lead({ phone: '+79146660001', service: 'training' }, ip);
  await lead({ phone: '89146660001', service: 'training', name: 'Кристина Иванова' }, ip);
  const rows = (await t.pool.query(`SELECT id, name FROM leads WHERE contact = '+79146660001'`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Кристина Иванова');
  const staff = await adminLogin('staff@x.com');
  assert.equal((await t.api('POST', `/api/admin/leads/${rows[0].id}/done`, {}, { cookie: staff })).statusCode, 200);
  assert.equal((await t.pool.query('SELECT is_new FROM leads WHERE id = $1', [rows[0].id])).rows[0].is_new, false);
  assert.equal((await t.api('DELETE', `/api/admin/leads/${rows[0].id}`, null, { cookie: staff })).statusCode, 403);
  const own = await adminLogin('owner@x.com');
  assert.equal((await t.api('DELETE', `/api/admin/leads/${rows[0].id}`, null, { cookie: own })).statusCode, 200);
  assert.equal((await t.pool.query(`SELECT count(*)::int n FROM leads WHERE contact = '+79146660001'`)).rows[0].n, 0);
});
