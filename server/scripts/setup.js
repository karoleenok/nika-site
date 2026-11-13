// Запускается перед стартом сервера: миграции, хранилище, демо-данные (только не на бою).
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createS3 } from '../src/s3.js';
import { migrate } from './migrate.js';
import { setupBucket } from './s3-setup.js';
import { seed, bootstrapProd } from './seed.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const s3 = createS3(config.s3);
try {
  await migrate(pool);
  if (!config.prod) {
    await setupBucket(s3, config.publicUrl);
    await seed(pool, s3);
  } else {
    await bootstrapProd(pool);
  }
} finally {
  await pool.end();
}
