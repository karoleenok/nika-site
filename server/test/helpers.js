// Тестовая база nika_test создаётся с нуля перед каждым файлом тестов. Боевые и демо-данные не трогаются.
import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createS3 } from '../src/s3.js';
import { buildApp } from '../src/app.js';
import { migrate } from '../scripts/migrate.js';

export async function setup() {
  const base = loadConfig();
  const url = new URL(base.databaseUrl); url.pathname = '/nika_test';
  const adminUrl = new URL(base.databaseUrl); adminUrl.pathname = '/postgres';
  const a = new pg.Client({ connectionString: adminUrl.toString() });
  await a.connect();
  await a.query('DROP DATABASE IF EXISTS nika_test WITH (FORCE)');
  await a.query('CREATE DATABASE nika_test');
  await a.end();
  const config = loadConfig({ ...process.env, DATABASE_URL: url.toString() });
  const pool = createPool(config.databaseUrl);
  await migrate(pool, () => {});
  const mails = [];
  const mailer = { async send(m) { mails.push(m); }, sendLater(m) { mails.push(m); } };
  const app = await buildApp({ config, pool, s3: createS3(config.s3), mailer, serveStatic: false });
  const origin = new URL(config.publicUrl).origin;
  let ip = 1;
  const api = (method, url, body, { cookie, ip: from = '10.0.0.1', headers = {} } = {}) => app.inject({
    method, url, payload: body, remoteAddress: from,
    headers: { origin, ...(cookie ? { cookie } : {}), ...headers },
  });
  return { app, pool, mails, api, config, freshIp: () => `10.1.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    async close() { await app.close(); await pool.end(); } };
}

// Достаёт из ответа куку вида "имя=значение" и её настройки
export function cookieOf(res, name) {
  const c = res.cookies.find((x) => x.name === name);
  return c ? { header: `${c.name}=${c.value}`, ...c } : null;
}
export const codeFrom = (mail) => mail.text.match(/Код для входа: (\d{6})/)[1];
export const tokenFrom = (mail) => mail.text.match(/\?t=([\w-]+)/)?.[1];
