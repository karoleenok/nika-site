import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createS3 } from './s3.js';
import { buildApp } from './app.js';
import { createMailer } from './mail.js';
import { cleanupAuth } from './auth/routes.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = await buildApp({ config, pool, s3: createS3(config.s3), mailer: createMailer(config.smtp) });

// Раз в час удаляем просроченные коды, ссылки и сессии
setInterval(() => cleanupAuth(pool).catch((e) => console.error('cleanup failed', e.message)), 3600e3).unref();

await app.listen({ port: config.port, host: process.env.HOST || '127.0.0.1' });
console.log(`Сайт: ${config.publicUrl}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
}
