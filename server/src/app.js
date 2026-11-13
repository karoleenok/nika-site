import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import authRoutes from './auth/routes.js';
import adminRoutes from './admin/routes.js';
import lkRoutes from './lk/routes.js';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function buildApp({ config, pool, s3, mailer, serveStatic = !config.prod }) {
  const app = Fastify({
    logger: config.prod ? { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] } : false,
    trustProxy: config.prod ? '127.0.0.1' : false,
    bodyLimit: 64 * 1024,
  });

  // Принимаем только JSON: обычная форма с чужого сайта не сможет отправить запрос
  app.removeContentTypeParser('text/plain');
  await app.register(fastifyCookie);

  // Защита от подделки запросов (CSRF): изменения принимаем только со своего сайта
  const origin = new URL(config.publicUrl).origin;
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || !req.url.startsWith('/api/')) return;
    const o = req.headers.origin;
    const sameSite = o ? o === origin : req.headers['sec-fetch-site'] === 'same-origin';
    if (!sameSite) return reply.code(403).send({ error: 'Запрос отклонён' });
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

  await authRoutes(app, { config, pool, mailer });
  await adminRoutes(app, { pool });
  await lkRoutes(app, { pool });

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
