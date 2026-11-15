// Создаёт бакет, закрывает публичный доступ и ставит CORS (только наш сайт, ExposeHeaders ETag).
import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';

// Сайт открывают и с www, и без: разрешаем оба адреса, иначе браузер с www не сможет загрузить файл.
export function corsOrigins(publicUrl) {
  const u = new URL(publicUrl), host = u.hostname;
  if (host === 'localhost' || /^[\d.]+$/.test(host)) return [u.origin];
  const other = host.startsWith('www.') ? host.slice(4) : 'www.' + host;
  return [u.origin, `${u.protocol}//${other}${u.port ? ':' + u.port : ''}`];
}

export function corsRules(publicUrl) {
  return [{
    AllowedOrigins: corsOrigins(publicUrl),
    AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  }];
}

export async function setupBucket(s3, publicUrl, log = console.log) {
  try { await s3.internal.send(new HeadBucketCommand({ Bucket: s3.bucket })); }
  catch { await s3.internal.send(new CreateBucketCommand({ Bucket: s3.bucket })); log(`бакет создан: ${s3.bucket}`); }
  await setupCors(s3, publicUrl, log);
}

// На бою бакет создан в панели Timeweb, но без CORS браузер не может загрузить в него файл:
// загрузка видео и материалов обрывается сразу. Поэтому CORS ставим при каждой выкладке.
export async function setupCors(s3, publicUrl, log = console.log) {
  await s3.internal.send(new PutBucketCorsCommand({ Bucket: s3.bucket, CORSConfiguration: { CORSRules: corsRules(publicUrl) } }));
  log(`CORS бакета: разрешены ${corsOrigins(publicUrl).join(', ')}`);
}
