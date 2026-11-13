// Все настройки только из переменных окружения. Смена значений = переход с локальной среды на боевую.
const required = ['PUBLIC_URL', 'SESSION_SECRET', 'DATABASE_URL', 'S3_ENDPOINT', 'S3_REGION',
  'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM'];

export function loadConfig(env = process.env) {
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Не заданы переменные окружения: ${missing.join(', ')}`);
  const prod = env.NODE_ENV === 'production';
  if (prod && env.SESSION_SECRET.length < 64) throw new Error('SESSION_SECRET короче 64 символов');
  if (prod && !env.PUBLIC_URL.startsWith('https://')) throw new Error('PUBLIC_URL на бою должен быть https');
  if (prod && !(env.ROBOKASSA_LOGIN && env.ROBOKASSA_PASSWORD1 && env.ROBOKASSA_PASSWORD2)) throw new Error('Не заданы ключи Robokassa');
  return Object.freeze({
    prod,
    port: Number(env.PORT || 3000),
    publicUrl: env.PUBLIC_URL.replace(/\/$/, ''),
    sessionSecret: env.SESSION_SECRET,
    databaseUrl: env.DATABASE_URL,
    s3: Object.freeze({
      endpoint: env.S3_ENDPOINT,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    }),
    smtp: Object.freeze({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT),
      secure: env.SMTP_SECURE === '1',
      user: env.SMTP_USER || '',
      password: env.SMTP_PASSWORD || '',
      from: env.MAIL_FROM,
      replyTo: env.MAIL_REPLY_TO || '',
      adminNotify: env.ADMIN_NOTIFY_EMAIL || '',
    }),
    robokassa: Object.freeze({
      login: env.ROBOKASSA_LOGIN || '',
      password1: env.ROBOKASSA_PASSWORD1 || '',
      password2: env.ROBOKASSA_PASSWORD2 || '',
      test: env.ROBOKASSA_TEST !== '0',
    }),
  });
}
