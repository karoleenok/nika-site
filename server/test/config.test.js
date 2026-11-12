import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = { PUBLIC_URL: 'http://localhost:3000', SESSION_SECRET: 'x', DATABASE_URL: 'postgres://a', S3_ENDPOINT: 'http://s3',
  S3_REGION: 'r', S3_BUCKET: 'b', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's', SMTP_HOST: 'h', SMTP_PORT: '1025', MAIL_FROM: 'a@b' };

test('без обязательных переменных сервер не стартует', () => {
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: '' }), /DATABASE_URL/);
});
test('на бою требуются https и длинный секрет', () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(64) }), /https/);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(64), PUBLIC_URL: 'https://a.ru/' }).publicUrl, 'https://a.ru');
});
test('Robokassa по умолчанию в тестовом режиме', () => {
  assert.equal(loadConfig(base).robokassa.test, true);
});
