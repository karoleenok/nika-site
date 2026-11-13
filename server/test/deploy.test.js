// Первый запуск на боевом сервере: каталог и первые админы без демо-данных.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { bootstrapProd } from '../scripts/seed.js';

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
const quiet = () => {};
const env = { INITIAL_ADMINS: 'owner:nika@site.ru:Ника, staff:diana@site.ru:Диана, tech:karolina@site.ru:Каролина' };

test('пустая база: каталог и три админа, демо-клиентов нет', async () => {
  await bootstrapProd(t.pool, env, quiet);
  const n = async (sql) => (await t.pool.query(sql)).rows[0].n;
  assert.equal(await n('SELECT count(*)::int n FROM tariffs'), 11);
  assert.equal(await n('SELECT count(*)::int n FROM admins'), 3);
  assert.equal(await n('SELECT count(*)::int n FROM users'), 0);
  const r = await t.pool.query("SELECT role, name FROM admins WHERE email = 'nika@site.ru'");
  assert.deepEqual(r.rows[0], { role: 'owner', name: 'Ника' });
});

test('повторный запуск ничего не дублирует и не меняет роли и цены', async () => {
  await t.pool.query("UPDATE admins SET role = 'owner' WHERE email = 'diana@site.ru'");
  await t.pool.query("UPDATE tariffs SET price_kop = 100 WHERE slug = 'train-1m'");
  await bootstrapProd(t.pool, { INITIAL_ADMINS: 'staff:diana@site.ru:Диана' }, quiet);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM tariffs')).rows[0].n, 11);
  assert.equal((await t.pool.query("SELECT role FROM admins WHERE email = 'diana@site.ru'")).rows[0].role, 'owner');
  assert.equal((await t.pool.query("SELECT price_kop FROM tariffs WHERE slug = 'train-1m'")).rows[0].price_kop, 100);
});

test('ошибка в записи админа останавливает запуск', async () => {
  await assert.rejects(bootstrapProd(t.pool, { INITIAL_ADMINS: 'boss:x@site.ru:X' }, quiet), /INITIAL_ADMINS/);
  await assert.rejects(bootstrapProd(t.pool, { INITIAL_ADMINS: 'owner:не-почта:X' }, quiet), /INITIAL_ADMINS/);
});

test('без владельца сервер не стартует', async () => {
  await t.pool.query("UPDATE admins SET active = false WHERE role = 'owner'");
  await assert.rejects(bootstrapProd(t.pool, {}, quiet), /владельца/);
});
