// Режим «уроки скоро появятся»: неопубликованные уроки видны клиенту карточкой «скоро», файл и описание закрыты.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf } from './helpers.js';
import { hashPassword } from '../src/auth/password.js';

let t, adm, lk, G, hiddenG, draft, live;
const ck = (r) => cookieOf(r, r.cookies[0].name).header;
const A = (method, url, body) => t.api(method, url, body, { cookie: adm });
const list = async () => (await t.api('GET', '/api/videos', undefined, { cookie: lk })).json();

before(async () => {
  t = await setup();
  const h = await hashPassword('Correct-Horse-7');
  await t.pool.query(`INSERT INTO admins (email, name, role, password_hash) VALUES ('owner@x.com','Ника','owner',$1)`, [h]);
  await t.pool.query(`INSERT INTO users (email, name, password_hash) VALUES ('on@x.com','Ольга',$1)`, [h]);
  adm = ck(await t.api('POST', '/api/auth/password', { email: 'owner@x.com', password: 'Correct-Horse-7', kind: 'admin' }, { ip: t.freshIp() }));
  lk = ck(await t.api('POST', '/api/auth/password', { email: 'on@x.com', password: 'Correct-Horse-7' }, { ip: t.freshIp() }));
  G = (await A('POST', '/api/admin/video-groups', { name: 'Ноги' })).json().id;
  hiddenG = (await A('POST', '/api/admin/video-groups', { name: 'Черновики', visible: false })).json().id;
  draft = (await A('POST', '/api/admin/videos', { title: 'Выпады', groupId: G, description: 'черновик описания', gear: ['коврик'] })).json().id;
  await A('POST', '/api/admin/videos', { title: 'Секретное', groupId: hiddenG });
  // Готовое опубликованное видео кладём прямо в базу: хранилище в этом тесте не нужно
  live = String((await t.pool.query(`INSERT INTO videos (title, group_id, description, gear, sort, status, published, s3_key, size_bytes)
    VALUES ('Приседания', $1, 'описание', '{}', 99, 'ready', true, 'videos/x.mp4', 10) RETURNING id`, [G])).rows[0].id);
});
after(() => t.close());

test('по умолчанию режим включён: черновик виден как «скоро», без описания и инвентаря; скрытая группа не видна', async () => {
  assert.equal((await A('GET', '/api/admin/settings')).json().videosSoon, true);
  const r = await list();
  assert.equal(r.soon, true);
  assert.deepEqual(r.videos.find((v) => v.id === draft), { id: draft, group: G, title: 'Выпады', text: '', gear: [], soon: true });
  const ready = r.videos.find((v) => v.id === live);
  assert.equal(ready.soon, undefined); assert.equal(ready.text, 'описание');
  assert.ok(!r.videos.some((v) => v.title === 'Секретное'));
  assert.ok(!JSON.stringify(r).includes('черновик описания'));
});

test('файл урока «скоро» открыть нельзя', async () => {
  assert.equal((await t.api('GET', `/api/videos/${draft}/play`, undefined, { cookie: lk })).statusCode, 404);
});

test('переключатель: только админ, выключили — черновики пропали, запись в журнале', async () => {
  assert.equal((await t.api('PUT', '/api/admin/settings', { videosSoon: false }, { cookie: lk })).statusCode, 401);
  assert.equal((await A('PUT', '/api/admin/settings', { videosSoon: 'да' })).statusCode, 400);
  assert.equal((await A('PUT', '/api/admin/settings', { videosSoon: false })).statusCode, 200);
  const r = await list();
  assert.equal(r.soon, false);
  assert.deepEqual(r.videos.map((v) => v.id), [live]);
  const log = (await t.pool.query(`SELECT meta FROM audit_log WHERE action = 'settings.videos_soon'`)).rows;
  assert.deepEqual(log.map((x) => x.meta), [{ on: false }]);
  assert.equal((await A('PUT', '/api/admin/settings', { videosSoon: true })).statusCode, 200);
  assert.equal((await list()).videos.length, 2);
});
