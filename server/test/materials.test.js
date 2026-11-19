// Материалы: карточка, обложка, загрузка файла в настоящее хранилище, проверка содержимого,
// доступ клиента только к купленному или подаренному. Нужна запущенная локальная среда (./start.sh).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { setup, cookieOf, codeFrom } from './helpers.js';
import { createS3 } from '../src/s3.js';

let t, s3, adm, staff, buyer, other, gifted;

async function login(email, kind) {
  t.mails.length = 0;
  const ip = t.freshIp();
  await t.api('POST', '/api/auth/code', { email, ...(kind ? { kind } : {}) }, { ip });
  const r = await t.api('POST', '/api/auth/verify', { email, code: codeFrom(t.mails.at(-1)), remember: true, ...(kind ? { kind } : {}) }, { ip });
  return cookieOf(r, kind === 'admin' ? 'nika_adm' : 'nika_lk').header;
}
const A = (method, url, body, cookie = adm) => t.api(method, url, body, { cookie });
const pdf = (size = 2000) => { const b = Buffer.alloc(size, 32); b.write('%PDF-1.7\n', 0, 'latin1'); return b; };
const exists = async (Key) => { try { await s3.internal.send(new HeadObjectCommand({ Bucket: s3.bucket, Key })); return true; } catch { return false; } };
const keyOf = async (id, col = 'file_key') => (await t.pool.query(`SELECT ${col} AS k FROM materials WHERE id = $1`, [id])).rows[0].k;

async function upload(id, name, body) {
  const s = await A('POST', `/api/admin/materials/${id}/file`, { name, size: body.length });
  assert.equal(s.statusCode, 200, s.body);
  const r = await fetch(s.json().url, { method: 'PUT', body, headers: { ...s.json().headers, Origin: t.config.publicUrl } });
  assert.equal(r.status, 200, 'хранилище приняло файл');
  return A('POST', `/api/admin/materials/${id}/file/done`, { name });
}

before(async () => {
  t = await setup();
  s3 = createS3(t.config.s3);
  await t.pool.query(`INSERT INTO admins (email, name, role) VALUES ('owner@x.com','Ника','owner'),('staff@x.com','Диана','staff')`);
  await t.pool.query(`INSERT INTO users (email, name) VALUES ('buy@x.com','Анна'),('no@x.com','Вера'),('food@x.com','Ира')`);
  await t.pool.query(`INSERT INTO tariffs (slug, kind, grp, name, price_kop) VALUES ('food-support','service','Питание','Сопровождение',1199900)`);
  await t.pool.query(`INSERT INTO orders (user_id, email, tariff_id, item_name, amount_kop, status, paid_at)
                      SELECT u.id, u.email, t.id, t.name, t.price_kop, 'manual', now() FROM users u, tariffs t WHERE u.email = 'food@x.com' AND t.slug = 'food-support'`);
  adm = await login('owner@x.com', 'admin');
  staff = await login('staff@x.com', 'admin');
  buyer = await login('buy@x.com');
  other = await login('no@x.com');
  gifted = await login('food@x.com');
});
after(() => t?.close());

test('без входа и клиенту админские маршруты закрыты', async () => {
  assert.equal((await t.api('GET', '/api/admin/materials')).statusCode, 401);
  assert.equal((await t.api('GET', '/api/admin/materials', undefined, { cookie: buyer })).statusCode, 401);
  assert.equal((await t.api('GET', '/api/me/materials')).statusCode, 401);
});

let M;
test('материал: создание, правка, цена только у Ники и Каролины', async () => {
  const bad = await A('POST', '/api/admin/materials', { title: '  ', kind: 'гайд' });
  assert.equal(bad.statusCode, 400);
  const r = await A('POST', '/api/admin/materials', { title: 'Сахар без паники', kind: 'гайд', text: 'Про сладкое', price: 990, old: 1500, on: false });
  assert.equal(r.statusCode, 201, r.body);
  M = r.json().material;
  assert.equal(M.price, 990); assert.equal(M.on, false); assert.equal(M.file, null);
  const tr = (await t.pool.query('SELECT kind, name, price_kop, active FROM tariffs WHERE slug = $1', [M.slug])).rows[0];
  assert.deepEqual(tr, { kind: 'material', name: 'Гайд «Сахар без паники»', price_kop: 99000, active: false });

  assert.equal((await A('PATCH', `/api/admin/materials/${M.id}`, { price: 10 }, staff)).statusCode, 403, 'Диана цены не меняет');
  assert.equal((await A('PATCH', `/api/admin/materials/${M.id}`, { text: 'Новое описание' }, staff)).statusCode, 200, 'а текст может');
  assert.equal((await A('PATCH', `/api/admin/materials/${M.id}`, { old: 500 })).statusCode, 400, 'старая цена ниже новой');
  const on = await A('PATCH', `/api/admin/materials/${M.id}`, { on: true });
  assert.equal(on.statusCode, 400, 'без файла не показываем');
  assert.match(on.json().error, /файл/);
});

test('обложка: только настоящая картинка, отдаётся с кэшем и без скриптов', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
  const fake = Buffer.from('<svg onload=alert(1)></svg>');
  assert.equal((await A('PUT', `/api/admin/materials/${M.id}/cover`, { type: 'image/png', data: fake.toString('base64') })).statusCode, 400);
  assert.equal((await A('PUT', `/api/admin/materials/${M.id}/cover`, { type: 'image/svg+xml', data: fake.toString('base64') })).statusCode, 400);
  const r = await A('PUT', `/api/admin/materials/${M.id}/cover`, { type: 'image/png', data: png.toString('base64') });
  assert.equal(r.statusCode, 200, r.body);
  const url = r.json().material.cover;
  assert.match(url, /^\/api\/materials\/\d+\/cover\?v=\d+$/);
  const g = await t.api('GET', url);
  assert.equal(g.statusCode, 200);
  assert.equal(g.headers['content-type'], 'image/png');
  assert.equal(g.headers['x-content-type-options'], 'nosniff');
  assert.ok(g.rawPayload.equals(png));
});

test('файл: тип по расширению, лимит размера, содержимое проверяется', async () => {
  assert.equal((await A('POST', `/api/admin/materials/${M.id}/file`, { name: 'virus.exe', size: 10 })).statusCode, 400);
  assert.equal((await A('POST', `/api/admin/materials/${M.id}/file`, { name: 'big.mp4', size: 2 * 1024 ** 3 })).statusCode, 400);
  // Выдаёт себя за PDF, а внутри html: не принимаем и стираем из хранилища
  const bad = await upload(M.id, 'guide.pdf', Buffer.from('<html><script>alert(1)</script></html>'.padEnd(200)));
  assert.equal(bad.statusCode, 400, bad.body);
  assert.equal(await keyOf(M.id, 'pending_key'), null);
  assert.equal(await keyOf(M.id), null);

  const ok = await upload(M.id, 'Сахар без паники.pdf', pdf());
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json().material.file, { name: 'Сахар без паники.pdf', type: 'application/pdf', sizeBytes: 2000 });
  const first = await keyOf(M.id);
  assert.ok(await exists(first));

  // Замена файла: старый стирается из хранилища
  assert.equal((await upload(M.id, 'v2.pdf', pdf(3000))).statusCode, 200);
  const second = await keyOf(M.id);
  assert.notEqual(first, second);
  assert.equal(await exists(first), false);
  assert.equal((await A('PATCH', `/api/admin/materials/${M.id}`, { on: true })).statusCode, 200);
});

test('клиент: видит материал, открыть может только купленный', async () => {
  const list = (await t.api('GET', '/api/me/materials', undefined, { cookie: other })).json().materials;
  const x = list.find((m) => m.id === M.id);
  assert.ok(x); assert.equal(x.owned, false); assert.equal(x.fileType, null);
  assert.equal((await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: other })).statusCode, 403);

  await t.pool.query(`INSERT INTO purchases (user_id, tariff_id) SELECT u.id, t.id FROM users u, tariffs t WHERE u.email = 'buy@x.com' AND t.slug = $1`, [M.slug]);
  const o = await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: buyer });
  assert.equal(o.statusCode, 200, o.body);
  assert.equal(o.headers['cache-control'], 'no-store');
  const f = await fetch(o.json().url);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'application/pdf');
  // Имя файла просим у хранилища в подписи (SeaweedFS его не применяет, S3 Timeweb применяет)
  assert.match(decodeURIComponent(new URL(o.json().url).searchParams.get('response-content-disposition')), /filename\*=UTF-8''v2\.pdf/);
  // Без подписи хранилище файл не отдаёт
  assert.notEqual((await fetch(o.json().url.split('?')[0])).status, 200);
});

test('подарок: открывается клиентам с сопровождением по питанию', async () => {
  assert.equal((await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: gifted })).statusCode, 403);
  assert.equal((await A('PATCH', `/api/admin/materials/${M.id}`, { gift: true })).statusCode, 200);
  assert.equal((await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: gifted })).statusCode, 200);
  assert.equal((await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: other })).statusCode, 403);
});

test('админ открывает материал клиенту без оплаты и закрывает обратно', async () => {
  const idOf = async (email) => (await t.pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
  const uid = await idOf('no@x.com');
  const row = async () => (await A('GET', `/api/admin/clients/${uid}/materials`)).json().materials.find((m) => m.id === M.id);
  assert.equal((await row()).on, false);
  assert.equal((await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: other })).statusCode, 403);
  assert.equal((await A('PUT', `/api/admin/clients/${uid}/materials/${M.id}`, { on: true })).statusCode, 200);
  assert.equal((await row()).on, true);
  assert.equal((await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: other })).statusCode, 200);
  assert.equal((await A('PUT', `/api/admin/clients/${uid}/materials/${M.id}`, { on: false })).statusCode, 200);
  assert.equal((await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: other })).statusCode, 403);
  // Купленный клиентом материал закрыть нельзя
  const bid = await idOf('buy@x.com');
  await t.pool.query(`UPDATE purchases SET order_id = (SELECT id FROM orders LIMIT 1) WHERE user_id = $1 AND tariff_id = (SELECT tariff_id FROM materials WHERE id = $2)`, [bid, M.id]);
  const paid = (await t.pool.query('SELECT order_id FROM purchases WHERE user_id = $1 AND order_id IS NOT NULL', [bid])).rowCount;
  if (paid) assert.equal((await A('PUT', `/api/admin/clients/${bid}/materials/${M.id}`, { on: false })).statusCode, 409);
  assert.equal((await t.api('PUT', `/api/admin/clients/${uid}/materials/${M.id}`, { on: true }, { cookie: buyer })).statusCode, 401);
});

test('бесплатный материал (цена 0) открывается всем клиентам', async () => {
  assert.equal((await A('PATCH', `/api/admin/materials/${M.id}`, { price: 0, old: 0 })).statusCode, 200);
  assert.equal((await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: other })).statusCode, 200);
  assert.equal((await A('PATCH', `/api/admin/materials/${M.id}`, { price: 990, old: 1500 })).statusCode, 200);
  assert.equal((await t.api('GET', `/api/me/materials/${M.id}/open`, undefined, { cookie: other })).statusCode, 403);
});

test('скрытый материал пропадает у тех, кто не купил, но остаётся у купивших', async () => {
  assert.equal((await A('PATCH', `/api/admin/materials/${M.id}`, { on: false, gift: false })).statusCode, 200);
  const no = (await t.api('GET', '/api/me/materials', undefined, { cookie: other })).json().materials;
  assert.ok(!no.some((m) => m.id === M.id));
  const yes = (await t.api('GET', '/api/me/materials', undefined, { cookie: buyer })).json().materials;
  assert.ok(yes.find((m) => m.id === M.id).owned);
});

test('удаление: купленный удалить нельзя, новый удаляется вместе с файлом', async () => {
  await t.pool.query(`INSERT INTO orders (user_id, email, tariff_id, item_name, amount_kop, status)
    SELECT u.id, u.email, t.id, t.name, 99000, 'paid' FROM users u, tariffs t WHERE u.email = 'buy@x.com' AND t.slug = $1`, [M.slug]);
  assert.equal((await A('DELETE', `/api/admin/materials/${M.id}`)).statusCode, 409);

  const n = (await A('POST', '/api/admin/materials', { title: 'Черновик', kind: 'видео-разбор' })).json().material;
  const v = Buffer.alloc(500, 1); v.write('\0\0\0\x18ftypisom', 0, 'latin1');
  assert.equal((await upload(n.id, 'razbor.mp4', v)).statusCode, 200);
  const key = await keyOf(n.id);
  assert.equal((await A('DELETE', `/api/admin/materials/${n.id}`)).statusCode, 200);
  assert.equal(await exists(key), false);
  assert.equal((await t.pool.query('SELECT 1 FROM tariffs WHERE slug = $1', [n.slug])).rowCount, 0);
  const log = (await t.pool.query(`SELECT action FROM audit_log WHERE target = $1 ORDER BY id`, [`material:${n.id}`])).rows.map((r) => r.action);
  assert.deepEqual(log, ['material.create', 'material.file', 'material.delete']);
});
