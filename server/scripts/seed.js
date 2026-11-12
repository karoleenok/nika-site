// Демо-данные. Только локально и только на пустой базе.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { tx } from '../src/db.js';

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed');

export async function seed(pool, s3, log = console.log) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM admins');
  if (rows[0].n > 0) { log('демо-данные уже есть, пропускаю'); return; }
  const sql = await fs.readFile(path.join(seedDir, 'demo.sql'), 'utf8');
  await tx(pool, async (c) => {
    await c.query(sql);
    for (let n = 1; n <= 5; n++) {
      const body = await fs.readFile(path.join(seedDir, 'videos', `demo-${n}.mp4`));
      const key = `video/demo-${n}.mp4`;
      await s3.internal.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: body, ContentType: 'video/mp4' }));
      await c.query('UPDATE videos SET size_bytes = $1 WHERE s3_key = $2', [body.length, key]);
    }
  });
  log('демо-данные загружены: 3 админа, 6 клиентов, 11 товаров, 5 видео, 2 заявки');
}
