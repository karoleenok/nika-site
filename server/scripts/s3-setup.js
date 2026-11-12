// Создаёт бакет, закрывает публичный доступ и ставит CORS (только наш сайт, ExposeHeaders ETag).
import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';

export function corsRules(publicUrl) {
  return [{
    AllowedOrigins: [publicUrl],
    AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  }];
}

export async function setupBucket(s3, publicUrl, log = console.log) {
  try { await s3.internal.send(new HeadBucketCommand({ Bucket: s3.bucket })); }
  catch { await s3.internal.send(new CreateBucketCommand({ Bucket: s3.bucket })); log(`бакет создан: ${s3.bucket}`); }
  await s3.internal.send(new PutBucketCorsCommand({ Bucket: s3.bucket, CORSConfiguration: { CORSRules: corsRules(publicUrl) } }));
  log(`CORS бакета: разрешён только ${publicUrl}`);
}
