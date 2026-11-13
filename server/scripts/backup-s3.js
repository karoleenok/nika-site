// Бэкапы базы в отдельное S3-хранилище (не то, где видео) и письмо-тревога.
// Запускается из deploy/server/backup.sh и restore-test.sh внутри образа приложения:
//   node scripts/backup-s3.js put <файл>       загрузить
//   node scripts/backup-s3.js prune [дней]     удалить старше N дней (по умолчанию 30)
//   node scripts/backup-s3.js latest <файл>    скачать самый свежий
//   node scripts/backup-s3.js alert <текст>    письмо на ALERT_EMAIL
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createS3 } from '../src/s3.js';
import { createMailer } from '../src/mail.js';

const env = process.env;
const PREFIX = 'db/';

function backupS3() {
  const need = ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_REGION', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Не заданы: ${missing.join(', ')}`);
  return createS3({ endpoint: env.BACKUP_S3_ENDPOINT, region: env.BACKUP_S3_REGION, bucket: env.BACKUP_S3_BUCKET,
    accessKeyId: env.BACKUP_S3_ACCESS_KEY, secretAccessKey: env.BACKUP_S3_SECRET_KEY });
}

async function listAll(s3) {
  const out = [];
  let ContinuationToken;
  do {
    const r = await s3.internal.send(new ListObjectsV2Command({ Bucket: s3.bucket, Prefix: PREFIX, ContinuationToken }));
    out.push(...(r.Contents || []));
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out.sort((a, b) => a.Key.localeCompare(b.Key));   // имена с датой: сортировка = по времени
}

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'put') {
  const s3 = backupS3();
  const size = fs.statSync(arg).size;
  if (size < 1024) throw new Error(`Файл бэкапа подозрительно маленький: ${size} байт`);
  await s3.internal.send(new PutObjectCommand({ Bucket: s3.bucket, Key: PREFIX + path.basename(arg),
    Body: fs.createReadStream(arg), ContentLength: size }));
  console.log(`бэкап загружен: ${path.basename(arg)}, ${(size / 1048576).toFixed(1)} МБ`);
} else if (cmd === 'prune') {
  const s3 = backupS3();
  const days = Number(arg || 30);
  const all = await listAll(s3);
  const cutoff = Date.now() - days * 86400e3;
  // Самые свежие 7 не удаляем никогда, даже если часы на сервере сбились
  const old = all.slice(0, Math.max(0, all.length - 7)).filter((o) => new Date(o.LastModified).getTime() < cutoff);
  if (old.length) await s3.internal.send(new DeleteObjectsCommand({ Bucket: s3.bucket,
    Delete: { Objects: old.map((o) => ({ Key: o.Key })) } }));
  console.log(`старых бэкапов удалено: ${old.length}, осталось: ${all.length - old.length}`);
} else if (cmd === 'latest') {
  const s3 = backupS3();
  const all = await listAll(s3);
  if (!all.length) throw new Error('В хранилище нет ни одного бэкапа');
  const last = all[all.length - 1];
  const r = await s3.internal.send(new GetObjectCommand({ Bucket: s3.bucket, Key: last.Key }));
  await pipeline(r.Body, fs.createWriteStream(arg));
  console.log(`скачан: ${last.Key}, от ${new Date(last.LastModified).toISOString()}`);
} else if (cmd === 'alert') {
  if (!env.ALERT_EMAIL) { console.error('ALERT_EMAIL не задан, письмо не отправлено'); process.exit(0); }
  const mailer = createMailer({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT), secure: env.SMTP_SECURE === '1',
    user: env.SMTP_USER || '', password: env.SMTP_PASSWORD || '', from: env.MAIL_FROM, replyTo: '' });
  const text = `${arg}\n\nСервер: ${env.PUBLIC_URL || 'не указан'}\nВремя: ${new Date().toISOString()}`;
  await mailer.send({ to: env.ALERT_EMAIL, subject: `Сайт Ники: ${arg}`, text, html: `<pre>${text.replace(/[<>&]/g, '')}</pre>` });
  console.log('тревога отправлена');
} else {
  console.error('Команды: put <файл> | prune [дней] | latest <файл> | alert <текст>');
  process.exit(2);
}
