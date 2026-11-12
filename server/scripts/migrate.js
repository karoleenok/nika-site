// Применяет новые файлы из server/migrations по порядку. Каждый файл в своей транзакции.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx } from '../src/db.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrate(pool, log = console.log) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = (await fs.readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await fs.readFile(path.join(dir, f), 'utf8');
    await tx(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(424242)');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
    log(`миграция применена: ${f}`);
  }
}
