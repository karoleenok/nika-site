import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createS3 } from './s3.js';
import { buildApp } from './app.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = buildApp({ config, pool, s3: createS3(config.s3) });

await app.listen({ port: config.port, host: process.env.HOST || '127.0.0.1' });
console.log(`Сайт: ${config.publicUrl}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
}
