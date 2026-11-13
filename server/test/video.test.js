// Видео: загрузка частями в настоящее хранилище (локальный S3), публикация, просмотр по ссылке, уборка.
// Нужна запущенная локальная среда (./start.sh): хранилище SeaweedFS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { HeadObjectCommand, CreateMultipartUploadCommand, ListMultipartUploadsCommand } from '@aws-sdk/client-s3';
import { setup, cookieOf, codeFrom } from './helpers.js';
import { createS3 } from '../src/s3.js';
import { cleanupUploads } from '../src/videos/cleanup.js';
import { PART_SIZE } from '../src/videos/routes.js';

let t, s3, adm, staff, lk, lkNo, G;
const MB = 1024 * 1024;

async function login(email, kind) {
  t.mails.length = 0;
  const ip = t.freshIp();
  await t.api('POST', '/api/auth/code', { email, ...(kind ? { kind } : {}) }, { ip });
  const r = await t.api('POST', '/api/auth/verify', { email, code: codeFrom(t.mails.at(-1)), remember: true, ...(kind ? { kind } : {}) }, { ip });
  return cookieOf(r, kind === 'admin' ? 'nika_adm' : 'nika_lk').header;
}
const A = (method, url, body, cookie = adm) => t.api(method, url, body, { cookie });

// Похожий на MP4 файл: метка ftyp на 4–8 байте
const mp4 = (size) => { const b = Buffer.alloc(size, 7); b.write('\0\0\0\x18ftypisom', 0, 'latin1'); return b; };

// Как делает браузер: подписи пачкой, PUT каждой части по подписанному адресу
async function putParts(uploadId, buf, nums) {
  const s = await A('POST', `/api/admin/uploads/${uploadId}/sign`, { parts: nums });
  assert.equal(s.statusCode, 200, s.body);
  for (const n of nums) {
    const body = buf.subarray((n - 1) * PART_SIZE, n * PART_SIZE);
    const r = await fetch(s.json().urls[n], { method: 'PUT', body, headers: { Origin: t.config.publicUrl } });
    assert.equal(r.status, 200, `часть ${n}`);
    assert.ok(r.headers.get('etag'), 'хранилище вернуло ETag');
  }
}
async function newVideo(title = 'Выпады', extra = {}) {
  const r = await A('POST', '/api/admin/videos', { title, groupId: G, ...extra });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id;
}
async function uploadWhole(id, buf, fp = `f-${id}`) {
  const init = await A('POST', `/api/admin/videos/${id}/upload`, { size: buf.length, type: 'video/mp4', fingerprint: fp });
  assert.equal(init.statusCode, 200, init.body);
  const u = init.json();
  await putParts(u.uploadId, buf, Array.from({ length: u.partCount }, (_, i) => i + 1));
  return { ...u, done: await A('POST', `/api/admin/uploads/${u.uploadId}/complete`) };
}

before(async () => {
  t = await setup();
  s3 = createS3(t.config.s3);
  await t.pool.query(`INSERT INTO admins (email, name, role) VALUES ('owner@x.com','Ника','owner'),('staff@x.com','Диана','staff')`);
  await t.pool.query(`INSERT INTO users (email, name) VALUES ('on@x.com','Ольга'),('off@x.com','Вера')`);
  await t.pool.query(`INSERT INTO access_periods (user_id, starts_at, ends_at, source)
                      SELECT id, now() - interval '1 day', now() + interval '20 days', 'manual' FROM users WHERE email = 'on@x.com'`);
  await t.pool.query(`INSERT INTO access_periods (user_id, starts_at, ends_at, source)
                      SELECT id, now() - interval '40 days', now() - interval '12 days', 'manual' FROM users WHERE email = 'off@x.com'`);
  adm = await login('owner@x.com', 'admin');
  staff = await login('staff@x.com', 'admin');
  lk = await login('on@x.com');
  lkNo = await login('off@x.com');
  const g = await A('POST', '/api/admin/video-groups', { name: 'Ноги' });
  assert.equal(g.statusCode, 201, g.body);
  G = g.json().id;
});
after(() => t.close());

test('права: без входа 401, клиент в админку видео не попадает', async () => {
  assert.equal((await t.api('GET', '/api/admin/videos')).statusCode, 401);
  assert.equal((await t.api('GET', '/api/admin/videos', undefined, { cookie: lk })).statusCode, 401);
  assert.equal((await t.api('GET', '/api/videos')).statusCode, 401);
  assert.equal((await t.api('GET', '/api/videos/1/play')).statusCode, 401);
  assert.equal((await A('GET', '/api/admin/videos', undefined, staff)).statusCode, 200, 'Диана работает с контентом');
});

test('загрузка принимает только MP4 до 2 ГБ', async () => {
  const id = await newVideo('Проверка формата');
  const up = (b) => A('POST', `/api/admin/videos/${id}/upload`, { fingerprint: 'x', ...b });
  assert.equal((await up({ size: 100, type: 'video/quicktime' })).statusCode, 400);
  assert.equal((await up({ size: 0, type: 'video/mp4' })).statusCode, 400);
  assert.equal((await up({ size: 2 * 1024 ** 3 + 1, type: 'video/mp4' })).statusCode, 400);
  const ok = await up({ size: 2 * 1024 ** 3, type: 'video/mp4' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().partCount, 205, '2 ГБ / 10 МБ');
  assert.equal((await A('DELETE', `/api/admin/uploads/${ok.json().uploadId}`)).statusCode, 200);
});

test('полный путь: части → сборка → проверка размера → готово → публикация → клиент смотрит', async () => {
  const id = await newVideo('Приседания', { text: 'Стопы шире плеч', gear: ['коврик', 'Коврик', 'гантели'] });
  // до загрузки опубликовать нельзя
  assert.equal((await A('PATCH', `/api/admin/videos/${id}`, { published: true })).statusCode, 409);
  const buf = mp4(PART_SIZE + 3 * MB);
  const r = await uploadWhole(id, buf);
  assert.equal(r.partCount, 2);
  assert.equal(r.done.statusCode, 200, r.done.body);
  const { videos } = (await A('GET', '/api/admin/videos')).json();
  const v = videos.find((x) => x.id === id);
  assert.equal(v.status, 'ready'); assert.equal(v.sizeBytes, buf.length); assert.equal(v.published, false, 'скрыто, пока не нажали «Опубликовать»');
  assert.deepEqual(v.gear, ['коврик', 'гантели']);
  assert.match((await t.pool.query('SELECT s3_key FROM videos WHERE id = $1', [id])).rows[0].s3_key, /^video\/[0-9a-f-]{36}\.mp4$/, 'ключ придумал сервер');

  // клиент не видит, пока не опубликовано
  assert.ok(!(await t.api('GET', '/api/videos', undefined, { cookie: lk })).json().videos.some((x) => x.id === id));
  assert.equal((await t.api('GET', `/api/videos/${id}/play`, undefined, { cookie: lk })).statusCode, 404);

  assert.equal((await A('PATCH', `/api/admin/videos/${id}`, { published: true })).statusCode, 200);
  const list = (await t.api('GET', '/api/videos', undefined, { cookie: lk })).json();
  assert.ok(list.videos.some((x) => x.id === id && x.text === 'Стопы шире плеч'));

  const play = await t.api('GET', `/api/videos/${id}/play`, undefined, { cookie: lk });
  assert.equal(play.statusCode, 200);
  const url = new URL(play.json().url);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300', 'ссылка на 5 минут');
  const file = await fetch(url, { headers: { Range: 'bytes=0-15' } });
  assert.equal(file.status, 206);
  assert.equal(file.headers.get('content-type'), 'video/mp4');

  // доступ закончился — ссылки нет
  const no = await t.api('GET', `/api/videos/${id}/play`, undefined, { cookie: lkNo });
  assert.equal(no.statusCode, 403);
  assert.ok(!no.body.includes('http'), 'в отказе нет ссылки');

  // группу спрятали — видео пропало у клиента
  await A('PATCH', `/api/admin/video-groups/${G}`, { visible: false });
  assert.equal((await t.api('GET', `/api/videos/${id}/play`, undefined, { cookie: lk })).statusCode, 404);
  await A('PATCH', `/api/admin/video-groups/${G}`, { visible: true });
});

test('продолжение: тот же файл — та же загрузка и список готовых частей; другой файл — старая отменяется', async () => {
  const id = await newVideo('Мостик');
  const buf = mp4(2 * PART_SIZE + MB);
  const a = (await A('POST', `/api/admin/videos/${id}/upload`, { size: buf.length, type: 'video/mp4', fingerprint: 'most.mp4|31457280|1' })).json();
  assert.equal(a.partCount, 3);
  await putParts(a.uploadId, buf, [1, 3]);   // вторая часть «оборвалась»
  const parts = (await A('GET', `/api/admin/uploads/${a.uploadId}/parts`)).json();
  assert.deepEqual(parts.done, [1, 3]);
  // завершить с дыркой нельзя
  assert.equal((await A('POST', `/api/admin/uploads/${a.uploadId}/complete`)).statusCode, 409);
  // страницу обновили, выбрали тот же файл
  const b = (await A('POST', `/api/admin/videos/${id}/upload`, { size: buf.length, type: 'video/mp4', fingerprint: 'most.mp4|31457280|1' })).json();
  assert.equal(b.uploadId, a.uploadId); assert.equal(b.resumed, true); assert.deepEqual(b.done, [1, 3]);
  await putParts(b.uploadId, buf, [2]);
  assert.equal((await A('POST', `/api/admin/uploads/${b.uploadId}/complete`)).statusCode, 200);

  // новая загрузка с другим файлом отменяет незаконченную
  const c = (await A('POST', `/api/admin/videos/${id}/upload`, { size: 6 * MB, type: 'video/mp4', fingerprint: 'other' })).json();
  const d = (await A('POST', `/api/admin/videos/${id}/upload`, { size: 7 * MB, type: 'video/mp4', fingerprint: 'third' })).json();
  assert.notEqual(c.uploadId, d.uploadId);
  assert.equal((await A('GET', `/api/admin/uploads/${c.uploadId}/parts`)).statusCode, 404);
  // у видео остался прежний готовый файл
  assert.equal((await A('GET', '/api/admin/videos')).json().videos.find((x) => x.id === id).status, 'ready');
  await A('DELETE', `/api/admin/uploads/${d.uploadId}`);
});

test('подписи: только свои части и не больше 20 за раз', async () => {
  const id = await newVideo('Подписи');
  const u = (await A('POST', `/api/admin/videos/${id}/upload`, { size: 3 * PART_SIZE, type: 'video/mp4', fingerprint: 's' })).json();
  assert.equal((await A('POST', `/api/admin/uploads/${u.uploadId}/sign`, { parts: [4] })).statusCode, 400);
  assert.equal((await A('POST', `/api/admin/uploads/${u.uploadId}/sign`, { parts: [0] })).statusCode, 400);
  assert.equal((await A('POST', `/api/admin/uploads/${u.uploadId}/sign`, { parts: Array(21).fill(1) })).statusCode, 400);
  const s = (await A('POST', `/api/admin/uploads/${u.uploadId}/sign`, { parts: [1, 2] })).json();
  assert.equal(new URL(s.urls[1]).searchParams.get('X-Amz-Expires'), '900', 'адрес части на 15 минут');
  await A('DELETE', `/api/admin/uploads/${u.uploadId}`);
  assert.equal((await A('POST', `/api/admin/uploads/${u.uploadId}/sign`, { parts: [1] })).statusCode, 404, 'после отмены подписей нет');
});

test('не MP4 внутри: загрузка помечается неудачной, файл удаляется', async () => {
  const id = await newVideo('Подделка');
  const buf = Buffer.alloc(MB, 1); // без метки ftyp
  const r = await uploadWhole(id, buf);
  assert.equal(r.done.statusCode, 422);
  const row = (await t.pool.query(`SELECT u.status, u.s3_key, v.status AS vs FROM uploads u JOIN videos v ON v.id = u.video_id WHERE u.id = $1`, [r.uploadId])).rows[0];
  assert.equal(row.status, 'failed'); assert.equal(row.vs, 'failed');
  await assert.rejects(s3.internal.send(new HeadObjectCommand({ Bucket: s3.bucket, Key: row.s3_key })), 'файла в хранилище нет');
});

test('замена файла: новый готов — старый удаляется из хранилища', async () => {
  const id = await newVideo('Замена');
  await uploadWhole(id, mp4(MB), 'one');
  const oldKey = (await t.pool.query('SELECT s3_key FROM videos WHERE id = $1', [id])).rows[0].s3_key;
  const r = await uploadWhole(id, mp4(2 * MB), 'two');
  assert.equal(r.done.statusCode, 200);
  await assert.rejects(s3.internal.send(new HeadObjectCommand({ Bucket: s3.bucket, Key: oldKey })));
});

test('удаление видео убирает файл; группу с видео удалить нельзя', async () => {
  const id = await newVideo('Удаляемое');
  await uploadWhole(id, mp4(MB));
  const key = (await t.pool.query('SELECT s3_key FROM videos WHERE id = $1', [id])).rows[0].s3_key;
  assert.equal((await A('DELETE', `/api/admin/video-groups/${G}`)).statusCode, 409);
  assert.equal((await A('DELETE', `/api/admin/videos/${id}`)).statusCode, 200);
  await assert.rejects(s3.internal.send(new HeadObjectCommand({ Bucket: s3.bucket, Key: key })));
  const log = await t.pool.query(`SELECT 1 FROM audit_log WHERE action = 'video.delete' AND target = $1`, [`video:${id}`]);
  assert.equal(log.rowCount, 1, 'в журнале');
});

test('порядок: место в группе и перестановка', async () => {
  const g = (await A('POST', '/api/admin/video-groups', { name: 'Спина' })).json().id;
  const a = (await A('POST', '/api/admin/videos', { title: 'A', groupId: g })).json().id;
  const b = (await A('POST', '/api/admin/videos', { title: 'B', groupId: g })).json().id;
  const c = (await A('POST', '/api/admin/videos', { title: 'C', groupId: g, pos: 0 })).json().id;
  const order = async () => (await A('GET', '/api/admin/videos')).json().videos.filter((v) => v.groupId === g).map((v) => v.title).join('');
  assert.equal(await order(), 'CAB');
  assert.equal((await A('POST', '/api/admin/videos/order', { groupId: g, ids: [b, c, a] })).statusCode, 200);
  assert.equal(await order(), 'BCA');
  assert.equal((await A('POST', '/api/admin/videos/order', { groupId: g, ids: [b, c] })).statusCode, 409, 'неполный список не принимаем');
  assert.equal((await A('POST', '/api/admin/video-groups', { name: 'спина' })).statusCode, 409, 'дубль группы');
});

test('уборка: незавершённые загрузки старше суток отменяются', async () => {
  const id = await newVideo('Брошенное');
  const u = (await A('POST', `/api/admin/videos/${id}/upload`, { size: 6 * MB, type: 'video/mp4', fingerprint: 'old' })).json();
  // и загрузка, о которой база не знает
  const orphan = await s3.internal.send(new CreateMultipartUploadCommand({ Bucket: s3.bucket, Key: 'video/orphan.mp4' }));
  const fresh = await cleanupUploads(t.pool, s3);
  assert.equal(fresh.rows, 0, 'свежие не трогаем');
  const r = await cleanupUploads(t.pool, s3, { now: Date.now() + 25 * 3600e3 });
  assert.ok(r.rows >= 1 && r.aborted >= 1, JSON.stringify(r));
  assert.equal((await t.pool.query('SELECT status FROM uploads WHERE id = $1', [u.uploadId])).rows[0].status, 'aborted');
  assert.equal((await t.pool.query('SELECT status FROM videos WHERE id = $1', [id])).rows[0].status, 'empty');
  const left = await s3.internal.send(new ListMultipartUploadsCommand({ Bucket: s3.bucket, Prefix: 'video/' }));
  assert.ok(!(left.Uploads || []).some((x) => x.UploadId === orphan.UploadId), 'сирота отменена');
});
