// Проверка локальной среды. Нужна запущенная среда (./start.sh).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, ListPartsCommand } from '@aws-sdk/client-s3';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createS3 } from '../src/s3.js';
import { migrate } from '../scripts/migrate.js';
import { seed } from '../scripts/seed.js';

const config = loadConfig();
const s3 = createS3(config.s3);
const site = config.publicUrl;
const pub = config.s3.publicEndpoint;
const quiet = () => {};

test('health: база и хранилище отвечают', async () => {
  const r = await fetch(`${site}/api/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, db: true, s3: true });
});

test('база: метки сроков и видео из сида', async () => {
  const pool = createPool(config.databaseUrl);
  try {
    const { rows } = await pool.query(`
      SELECT u.email,
        CASE WHEN max(a.ends_at) FILTER (WHERE a.closed_at IS NULL) IS NULL
               OR max(a.ends_at) FILTER (WHERE a.closed_at IS NULL) < now() THEN 'red'
             WHEN max(a.ends_at) FILTER (WHERE a.closed_at IS NULL) < now() + interval '7 days' THEN 'yellow'
             ELSE 'green' END AS label
      FROM users u LEFT JOIN access_periods a ON a.user_id = u.id GROUP BY u.email`);
    const count = (l) => rows.filter((r) => r.label === l).length;
    assert.deepEqual([count('green'), count('yellow'), count('red')], [1, 3, 2]);
    const v = await pool.query(`SELECT count(*)::int n, min(size_bytes)::int s FROM videos WHERE status='ready' AND s3_key LIKE 'video/demo-%'`);
    assert.equal(v.rows[0].n, 5);
    assert.ok(v.rows[0].s > 0, 'размер видео записан');
    // повторный запуск миграций и сида ничего не ломает и не дублирует
    await migrate(pool, quiet); await seed(pool, s3, quiet);
    assert.equal((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n, 6);
  } finally { await pool.end(); }
});

test('хранилище закрыто: без подписи видео не открыть, с подписью открывается', async () => {
  const anon = await fetch(`${pub}/${s3.bucket}/video/demo-1.mp4`);
  assert.ok([401, 403].includes(anon.status), `без подписи вернулся ${anon.status}`);
  const url = await getSignedUrl(s3.signer, new GetObjectCommand({ Bucket: s3.bucket, Key: 'video/demo-1.mp4' }), { expiresIn: 300 });
  const ok = await fetch(url);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'video/mp4');
});

test('загрузка частями по подписанным адресам, как из браузера (CORS + ETag)', async () => {
  const Key = `video/test-${Date.now()}.mp4`;
  const { UploadId } = await s3.internal.send(new CreateMultipartUploadCommand({ Bucket: s3.bucket, Key, ContentType: 'video/mp4' }));
  const part1 = Buffer.alloc(5 * 1024 * 1024, 1); // минимум для не последней части по правилам S3
  const part2 = Buffer.alloc(1024, 2);
  const parts = [];
  for (const [i, body] of [part1, part2].entries()) {
    const url = await getSignedUrl(s3.signer, new UploadPartCommand({ Bucket: s3.bucket, Key, UploadId, PartNumber: i + 1 }), { expiresIn: 900 });
    const pre = await fetch(url, { method: 'OPTIONS', headers: { Origin: site, 'Access-Control-Request-Method': 'PUT' } });
    assert.equal(pre.headers.get('access-control-allow-origin'), site, 'CORS разрешает наш сайт');
    const r = await fetch(url, { method: 'PUT', body, headers: { Origin: site } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('access-control-expose-headers') || '', /etag/i, 'браузер увидит ETag');
    parts.push({ PartNumber: i + 1, ETag: r.headers.get('etag') });
  }
  const listed = await s3.internal.send(new ListPartsCommand({ Bucket: s3.bucket, Key, UploadId }));
  assert.equal(listed.Parts.length, 2, 'список частей для продолжения загрузки');
  await s3.internal.send(new CompleteMultipartUploadCommand({ Bucket: s3.bucket, Key, UploadId, MultipartUpload: { Parts: parts } }));
  const head = await s3.internal.send(new HeadObjectCommand({ Bucket: s3.bucket, Key }));
  assert.equal(head.ContentLength, part1.length + part2.length, 'размер сходится');
  await s3.internal.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key }));
});

test('CORS не пускает чужой сайт', async () => {
  const url = await getSignedUrl(s3.signer, new GetObjectCommand({ Bucket: s3.bucket, Key: 'video/demo-1.mp4' }), { expiresIn: 60 });
  const r = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  assert.notEqual(r.headers.get('access-control-allow-origin'), 'https://evil.example');
  assert.notEqual(r.headers.get('access-control-allow-origin'), '*');
});

test('статика: страницы открываются, служебные файлы нет', async () => {
  for (const p of ['/', '/lk/login.html', '/admin/login.html', '/css/tokens.css']) {
    assert.equal((await fetch(site + p)).status, 200, p);
  }
  for (const p of ['/.env', '/.env.example', '/server/package.json', '/server/src/config.js', '/.git/config', '/docker-compose.yml', '/start.sh', '/README.md']) {
    assert.notEqual((await fetch(site + p)).status, 200, p);
  }
  assert.equal((await fetch(`${site}/api/nope`)).status, 404);
});
