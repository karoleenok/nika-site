import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function buildApp({ config, pool, s3, serveStatic = !config.prod }) {
  const app = Fastify({
    logger: config.prod ? { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] } : false,
    trustProxy: config.prod ? '127.0.0.1' : false,
    bodyLimit: 64 * 1024,
  });

  // Ошибки наружу без подробностей
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'server error');
    reply.code(status).send({ error: status >= 500 ? 'Что-то пошло не так. Попробуй ещё раз.' : err.message });
  });

  // Для внешнего мониторинга: база и хранилище отвечают
  app.get('/api/health', async (req, reply) => {
    const checks = { db: false, s3: false };
    try { await pool.query('SELECT 1'); checks.db = true; } catch {}
    try { await s3.internal.send(new HeadBucketCommand({ Bucket: s3.bucket })); checks.s3 = true; } catch {}
    const ok = checks.db && checks.s3;
    reply.code(ok ? 200 : 503).header('cache-control', 'no-store');
    return { ok, ...checks };
  });

  app.all('/api/*', async (req, reply) => reply.code(404).send({ error: 'Не найдено' }));

  // Локально сервер сам раздаёт статику сайта. На бою это делает nginx.
  if (serveStatic) {
    app.register(fastifyStatic, {
      root: siteRoot,
      allowedPath: (p) => !/^\/(server|node_modules|\.git|\.env|_backup|tools|docker-compose\.yml|start\.sh|README\.md)(\/|$)/.test(p) && !/\/\./.test(p),
      extensions: ['html'],
    });
  }
  return app;
}
