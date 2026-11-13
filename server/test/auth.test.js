import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf, codeFrom, tokenFrom } from './helpers.js';

let t;
before(async () => {
  t = await setup();
  await t.pool.query(`INSERT INTO users (email, name) VALUES ('anna@example.com','Анна'), ('bob@example.com','Боб'), ('pwuser@example.com','Пароль'), ('lim@example.com','Лимит')`);
  await t.pool.query(`INSERT INTO admins (email, name, role) VALUES ('nika@example.com','Ника','owner'), ('off@example.com','Бывший','staff')`);
  await t.pool.query(`UPDATE admins SET active = false WHERE email = 'off@example.com'`);
});
after(() => t.close());

const LK = 'nika_lk', ADM = 'nika_adm';
const fresh = (email) => t.pool.query('DELETE FROM login_codes WHERE email = $1', [email]); // сброс лимита на почту между проверками
async function login(email, { remember = true, kind = 'user', ip } = {}) {
  await fresh(email);
  t.mails.length = 0;
  const from = ip || t.freshIp();
  await t.api('POST', '/api/auth/code', { email, kind }, { ip: from });
  const code = codeFrom(t.mails.at(-1));
  const r = await t.api('POST', '/api/auth/verify', { email, code, kind, remember }, { ip: from });
  assert.equal(r.statusCode, 200, r.body);
  return cookieOf(r, kind === 'admin' ? ADM : LK);
}

// ---------- Коды ----------
test('«получить код»: одинаковый ответ, есть почта в базе или нет', async () => {
  t.mails.length = 0;
  const a = await t.api('POST', '/api/auth/code', { email: 'anna@example.com' }, { ip: t.freshIp() });
  const b = await t.api('POST', '/api/auth/code', { email: 'nobody@example.com' }, { ip: t.freshIp() });
  assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
  assert.equal(a.body, b.body);
  assert.equal(t.mails.length, 1, 'письмо ушло только существующей почте');
  assert.equal(t.mails[0].subject, 'Вход в кабинет Ники Дупиной');
  assert.match(t.mails[0].text, /Код для входа: \d{6}/);
  assert.ok(tokenFrom(t.mails[0]).length >= 43, 'ссылка: токен 32+ байта');
});

test('код: верный пускает, второй раз не подходит', async () => {
  const ip = t.freshIp();
  t.mails.length = 0;
  await t.api('POST', '/api/auth/code', { email: 'anna@example.com' }, { ip });
  const code = codeFrom(t.mails[0]);
  const ok = await t.api('POST', '/api/auth/verify', { email: 'ANNA@example.com ', code, remember: true }, { ip });
  assert.equal(ok.statusCode, 200);
  assert.ok(cookieOf(ok, LK));
  const again = await t.api('POST', '/api/auth/verify', { email: 'anna@example.com', code }, { ip });
  assert.equal(again.statusCode, 400);
});

test('код: 5 неверных попыток сжигают код, даже верный потом не подходит', async () => {
  t.mails.length = 0;
  await t.api('POST', '/api/auth/code', { email: 'bob@example.com' }, { ip: t.freshIp() });
  const code = codeFrom(t.mails[0]);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 4; i >= 1; i--) {
    const r = await t.api('POST', '/api/auth/verify', { email: 'bob@example.com', code: wrong });
    assert.equal(r.json().attemptsLeft, i);
  }
  const last = await t.api('POST', '/api/auth/verify', { email: 'bob@example.com', code: wrong });
  assert.equal(last.json().attemptsLeft, 0);
  const right = await t.api('POST', '/api/auth/verify', { email: 'bob@example.com', code });
  assert.equal(right.statusCode, 400);
});

test('код: через 10 минут не подходит', async () => {
  await fresh('bob@example.com');
  t.mails.length = 0;
  await t.api('POST', '/api/auth/code', { email: 'bob@example.com' }, { ip: t.freshIp() });
  const code = codeFrom(t.mails[0]);
  await t.pool.query(`UPDATE login_codes SET expires_at = now() - interval '1 second' WHERE email = 'bob@example.com' AND used_at IS NULL`);
  assert.equal((await t.api('POST', '/api/auth/verify', { email: 'bob@example.com', code })).statusCode, 400);
});

test('код: новый запрос гасит старый код', async () => {
  await fresh('bob@example.com');
  const ip = t.freshIp();
  t.mails.length = 0;
  await t.api('POST', '/api/auth/code', { email: 'bob@example.com' }, { ip });
  await t.api('POST', '/api/auth/code', { email: 'bob@example.com' }, { ip });
  const [first, second] = t.mails.map(codeFrom);
  if (first !== second) assert.equal((await t.api('POST', '/api/auth/verify', { email: 'bob@example.com', code: first })).statusCode, 400);
  assert.equal((await t.api('POST', '/api/auth/verify', { email: 'bob@example.com', code: second })).statusCode, 200);
});

test('лимит на почту: после 3 запросов за 15 минут письма не уходят, ответ тот же', async () => {
  t.mails.length = 0;
  const bodies = [];
  for (let i = 0; i < 5; i++) bodies.push((await t.api('POST', '/api/auth/code', { email: 'lim@example.com' }, { ip: t.freshIp() })).body);
  assert.equal(t.mails.length, 3);
  assert.equal(new Set(bodies).size, 1, 'ответ не выдаёт лимит');
});

test('лимит на адрес: 11-й запрос с одного IP за 15 минут получает отказ', async () => {
  const ip = t.freshIp();
  for (let i = 0; i < 10; i++) assert.equal((await t.api('POST', '/api/auth/code', { email: `x${i}@example.com` }, { ip })).statusCode, 200);
  assert.equal((await t.api('POST', '/api/auth/code', { email: 'x99@example.com' }, { ip })).statusCode, 429);
});

// ---------- Ссылка из письма ----------
test('ссылка: проверка её не тратит, вход по POST тратит, второй раз не работает', async () => {
  await fresh('anna@example.com');
  t.mails.length = 0;
  await t.api('POST', '/api/auth/code', { email: 'anna@example.com' }, { ip: t.freshIp() });
  const tok = tokenFrom(t.mails[0]);
  assert.equal((await t.api('POST', '/api/auth/link', { t: tok, check: true })).statusCode, 200);
  assert.equal((await t.api('POST', '/api/auth/link', { t: tok, check: true })).statusCode, 200, 'проверка не сжигает');
  const r = await t.api('POST', '/api/auth/link', { t: tok, remember: false });
  assert.equal(r.statusCode, 200);
  assert.ok(cookieOf(r, LK));
  assert.equal((await t.api('POST', '/api/auth/link', { t: tok })).statusCode, 400);
  assert.equal((await t.api('GET', `/api/auth/link?t=${tok}`)).statusCode, 404, 'открытие ссылки GET-запросом ничего не делает');
});

test('ссылка: через 15 минут не работает; после входа по коду ссылка гаснет', async () => {
  await fresh('anna@example.com');
  t.mails.length = 0;
  const ip = t.freshIp();
  await t.api('POST', '/api/auth/code', { email: 'anna@example.com' }, { ip });
  const tok = tokenFrom(t.mails[0]);
  await t.pool.query(`UPDATE login_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`);
  assert.equal((await t.api('POST', '/api/auth/link', { t: tok })).statusCode, 400);
  t.mails.length = 0;
  await t.api('POST', '/api/auth/code', { email: 'anna@example.com' }, { ip });
  const tok2 = tokenFrom(t.mails[0]);
  await t.api('POST', '/api/auth/verify', { email: 'anna@example.com', code: codeFrom(t.mails[0]) }, { ip });
  assert.equal((await t.api('POST', '/api/auth/link', { t: tok2 })).statusCode, 400);
});

// ---------- Сессии ----------
test('сессия: кука HttpOnly, SameSite=Lax; «запомнить» = 30 дней, без галочки — до закрытия браузера', async () => {
  const keep = await login('anna@example.com', { remember: true });
  assert.equal(keep.httpOnly, true);
  assert.equal(keep.sameSite, 'Lax');
  assert.equal(keep.path, '/');
  assert.equal(keep.maxAge, 30 * 86400);
  const temp = await login('anna@example.com', { remember: false });
  assert.equal(temp.maxAge, undefined);
  const adm = await login('nika@example.com', { kind: 'admin', remember: true });
  assert.equal(adm.maxAge, 14 * 86400);
});

test('сессия: без куки 401, с кукой профиль; выход закрывает сессию на сервере', async () => {
  assert.equal((await t.api('GET', '/api/me')).statusCode, 401);
  const c = await login('anna@example.com');
  const me = await t.api('GET', '/api/me', null, { cookie: c.header });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), { name: 'Анна', email: 'anna@example.com', hasPassword: false });
  await t.api('POST', '/api/auth/logout', {}, { cookie: c.header });
  assert.equal((await t.api('GET', '/api/me', null, { cookie: c.header })).statusCode, 401, 'старая кука больше не работает');
});

test('сессия: кабинет продлевается при заходе, админка нет', async () => {
  const c = await login('anna@example.com');
  await t.pool.query(`UPDATE sessions SET last_seen_at = now() - interval '2 hours', expires_at = now() + interval '5 days' WHERE user_id IS NOT NULL`);
  const r = await t.api('GET', '/api/me', null, { cookie: c.header });
  assert.equal(cookieOf(r, LK).maxAge, 30 * 86400, 'кука перевыпущена на 30 дней');
  const a = await login('nika@example.com', { kind: 'admin' });
  await t.pool.query(`UPDATE sessions SET last_seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day' WHERE admin_id IS NOT NULL`);
  const r2 = await t.api('GET', '/api/admin/me', null, { cookie: a.header });
  assert.equal(r2.statusCode, 200);
  assert.equal(cookieOf(r2, ADM), null, 'админская кука не продлевается');
});

test('сессия: просроченная не пускает', async () => {
  const c = await login('bob@example.com');
  await t.pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email='bob@example.com')`);
  assert.equal((await t.api('GET', '/api/me', null, { cookie: c.header })).statusCode, 401);
});

// ---------- Права ----------
test('права: /api/admin/* без входа 401, с кукой клиента 401, с кукой админа 200', async () => {
  assert.equal((await t.api('GET', '/api/admin/me')).statusCode, 401);
  const u = await login('anna@example.com');
  assert.equal((await t.api('GET', '/api/admin/me', null, { cookie: u.header })).statusCode, 401);
  assert.equal((await t.api('GET', '/api/admin/anything', null, { cookie: u.header })).statusCode, 401, 'закрыт любой адрес админки');
  const a = await login('nika@example.com', { kind: 'admin' });
  const me = await t.api('GET', '/api/admin/me', null, { cookie: a.header });
  assert.deepEqual(me.json(), { name: 'Ника', email: 'nika@example.com', role: 'owner' });
  const log = await t.pool.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'login'`);
  assert.ok(log.rows[0].n >= 1, 'вход админа записан в журнал');
});

test('права: клиент не может войти в админку по своему коду; отключённый админ не получает письмо', async () => {
  t.mails.length = 0;
  await t.api('POST', '/api/auth/code', { email: 'anna@example.com', kind: 'admin' }, { ip: t.freshIp() });
  await t.api('POST', '/api/auth/code', { email: 'off@example.com', kind: 'admin' }, { ip: t.freshIp() });
  assert.equal(t.mails.length, 0);
});

test('права: отключённый админ теряет доступ сразу', async () => {
  await t.pool.query(`UPDATE admins SET active = true WHERE email = 'off@example.com'`);
  const a = await login('off@example.com', { kind: 'admin' });
  await t.pool.query(`UPDATE admins SET active = false WHERE email = 'off@example.com'`);
  assert.equal((await t.api('GET', '/api/admin/me', null, { cookie: a.header })).statusCode, 401);
});

test('CSRF: запрос с чужого сайта отклоняется, текст вместо JSON тоже', async () => {
  const r = await t.api('POST', '/api/auth/code', { email: 'anna@example.com' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(r.statusCode, 403);
  const r2 = await t.app.inject({ method: 'POST', url: '/api/auth/code', payload: 'email=a', headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' } });
  assert.equal(r2.statusCode, 415);
});

// ---------- Пароль ----------
test('пароль: правила — 8 символов, частые, часть почты', async () => {
  const c = await login('pwuser@example.com');
  for (const [pw, re] of [['short', /короче 8/], ['12345678', /простой/], ['aaaaaaaaa', /простой/], ['my-PWuser-1', /почты/]]) {
    const r = await t.api('PUT', '/api/me/password', { password: pw }, { cookie: c.header });
    assert.equal(r.statusCode, 400); assert.match(r.json().error, re);
  }
});

test('пароль: задать, войти, единое сообщение об ошибке, хеш argon2id', async () => {
  const c = await login('pwuser@example.com');
  assert.equal((await t.api('PUT', '/api/me/password', { password: 'Лунный кот 42' }, { cookie: c.header })).statusCode, 200);
  const h = (await t.pool.query(`SELECT password_hash FROM users WHERE email='pwuser@example.com'`)).rows[0].password_hash;
  assert.match(h, /^\$argon2id\$/);
  assert.equal((await t.api('GET', '/api/me', null, { cookie: c.header })).json().hasPassword, true);
  const ok = await t.api('POST', '/api/auth/password', { email: 'pwuser@example.com', password: 'Лунный кот 42', remember: true }, { ip: t.freshIp() });
  assert.equal(ok.statusCode, 200);
  const wrongPw = await t.api('POST', '/api/auth/password', { email: 'pwuser@example.com', password: 'не тот' }, { ip: t.freshIp() });
  const noUser = await t.api('POST', '/api/auth/password', { email: 'ghost@example.com', password: 'не тот' }, { ip: t.freshIp() });
  const noPw = await t.api('POST', '/api/auth/password', { email: 'bob@example.com', password: 'не тот' }, { ip: t.freshIp() });
  assert.equal(wrongPw.body, noUser.body); assert.equal(noUser.body, noPw.body);
  assert.match(wrongPw.json().error, /Неверная почта или пароль/);
});

test('пароль: смена и удаление закрывают сессии на других устройствах и шлют письмо', async () => {
  const phone = await login('pwuser@example.com');
  const laptop = await login('pwuser@example.com');
  t.mails.length = 0;
  assert.equal((await t.api('PUT', '/api/me/password', { password: 'Другой пароль 7' }, { cookie: laptop.header })).statusCode, 200);
  assert.equal((await t.api('GET', '/api/me', null, { cookie: phone.header })).statusCode, 401, 'телефон вышел');
  assert.equal((await t.api('GET', '/api/me', null, { cookie: laptop.header })).statusCode, 200, 'текущее устройство осталось');
  assert.equal(t.mails.length, 1);
  const tablet = await login('pwuser@example.com');
  assert.equal((await t.api('DELETE', '/api/me/password', undefined, { cookie: laptop.header })).statusCode, 200);
  assert.equal((await t.api('GET', '/api/me', null, { cookie: tablet.header })).statusCode, 401);
  assert.equal((await t.api('POST', '/api/auth/password', { email: 'pwuser@example.com', password: 'Другой пароль 7' }, { ip: t.freshIp() })).statusCode, 400, 'старым паролем не войти');
});

test('пароль: после 5 ошибок на почту вход паролем закрыт на 15 минут', async () => {
  const c = await login('bob@example.com');
  await t.api('PUT', '/api/me/password', { password: 'Боб и море 2026' }, { cookie: c.header });
  for (let i = 0; i < 5; i++) await t.api('POST', '/api/auth/password', { email: 'bob@example.com', password: 'nope' }, { ip: t.freshIp() });
  const r = await t.api('POST', '/api/auth/password', { email: 'bob@example.com', password: 'Боб и море 2026' }, { ip: t.freshIp() });
  assert.equal(r.statusCode, 429);
});

test('«не помню пароль»: код по-прежнему работает', async () => {
  const c = await login('bob@example.com');
  assert.ok(c);
});
