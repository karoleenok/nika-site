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
  const catalog = await fs.readFile(path.join(seedDir, 'catalog.sql'), 'utf8');
  const sql = await fs.readFile(path.join(seedDir, 'demo.sql'), 'utf8');
  await tx(pool, async (c) => {
    await c.query(catalog);
    await c.query(sql);
    for (let n = 1; n <= 5; n++) {
      const body = await fs.readFile(path.join(seedDir, 'videos', `demo-${n}.mp4`));
      const key = `video/demo-${n}.mp4`;
      await s3.internal.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: body, ContentType: 'video/mp4' }));
      await c.query('UPDATE videos SET size_bytes = $1 WHERE s3_key = $2', [body.length, key]);
    }
  });
  log('демо-данные загружены: 3 админа, 6 клиентов, 11 товаров, 3 оплаты, 5 видео, 2 заявки');
}

// Боевой сервер: демо нет. Один раз, на пустой базе, заводим каталог и первых админов.
// INITIAL_ADMINS="owner:почта:Имя,staff:почта:Имя,tech:почта:Имя". Существующих админов не меняем:
// дальше роли и доступы правятся в админке, а не переменными.
export async function bootstrapProd(pool, env = process.env, log = console.log) {
  await tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(424243)');
    const t = await c.query('SELECT count(*)::int AS n FROM tariffs');
    if (t.rows[0].n === 0) {
      await c.query(await fs.readFile(path.join(seedDir, 'catalog.sql'), 'utf8'));
      log('каталог товаров загружен');
    }
    const list = String(env.INITIAL_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const item of list) {
      const [role, email, ...rest] = item.split(':').map((s) => s.trim());
      if (!['owner', 'staff', 'tech'].includes(role) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) {
        throw new Error(`INITIAL_ADMINS: не понял запись «${item}», нужно роль:почта:Имя`);
      }
      const r = await c.query('INSERT INTO admins (email, name, role) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
        [email, rest.join(':') || email, role]);
      if (r.rowCount) log(`админ добавлен: ${role}`);
    }
    const a = await c.query("SELECT count(*)::int AS n FROM admins WHERE role = 'owner' AND active");
    if (a.rows[0].n === 0) throw new Error('Нет ни одного владельца (owner). Задай INITIAL_ADMINS');
  });
}
