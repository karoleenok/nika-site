// Видео: группы, карточки, загрузка файла частями прямо из браузера в S3, просмотр по подписанной ссылке.
// Файл через наш сервер не идёт: сервер только выдаёт подписи и проверяет результат.
// Права: все роли админки работают с контентом (это допущение, подтвердить у Ники).
import { randomUUID } from 'node:crypto';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { tx } from '../db.js';
import { audit } from '../access.js';
import { Limiter } from '../auth/limits.js';

export const MAX_SIZE = 2 * 1024 ** 3;        // 2 ГБ
export const PART_SIZE = 10 * 1024 ** 2;      // 10 МБ: S3 требует от 5 МБ на каждую часть, кроме последней
export const PART_URL_TTL = 15 * 60;          // подпись части живёт 15 минут
export const PLAY_URL_TTL = 5 * 60;           // ссылка на просмотр живёт 5 минут
const SIGN_BATCH = 20;                        // сколько подписей за один запрос

const bad = (reply, status, error) => reply.code(status).send({ error });
const idOf = (v) => (/^\d{1,15}$/.test(String(v)) ? String(v) : null);
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const cleanGear = (v) => {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const g of v.slice(0, 12)) {
    const t = text(g, 30);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
};

const videoView = (r) => ({
  id: String(r.id), groupId: String(r.group_id), title: r.title, text: r.description, gear: r.gear || [],
  status: r.status, published: r.published, sizeBytes: r.size_bytes ? Number(r.size_bytes) : 0,
  upload: r.up_id ? { id: String(r.up_id), sizeBytes: Number(r.up_size), parts: r.up_parts } : null,
});
const groupView = (g) => ({ id: String(g.id), name: g.name, visible: g.visible });

// Все части загрузки по данным самого хранилища (ему верим больше, чем браузеру)
async function listAllParts(s3, key, uploadId) {
  const parts = [];
  let marker;
  for (let i = 0; i < 20; i++) {
    const r = await s3.internal.send(new ListPartsCommand({ Bucket: s3.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
    for (const p of r.Parts || []) parts.push({ n: p.PartNumber, etag: p.ETag, size: Number(p.Size) });
    if (!r.IsTruncated) break;
    marker = r.NextPartNumberMarker;
  }
  return parts.sort((a, b) => a.n - b.n);
}

const quietly = async (fn) => { try { await fn(); } catch { /* уже удалено или не было */ } };

export default async function videoRoutes(app, { pool, s3 }) {
  const noStore = (reply) => reply.header('cache-control', 'no-store');
  const S3 = (cmd) => s3.internal.send(cmd);
  const playLimit = new Limiter({ max: 120, windowMs: 60 * 60 * 1000 });   // клиенту: 120 ссылок в час
  const signLimit = new Limiter({ max: 3000, windowMs: 60 * 60 * 1000 });  // админу: подписи частей
  const sweep = setInterval(() => { playLimit.sweep(); signLimit.sweep(); }, 10 * 60 * 1000);
  sweep.unref();
  app.addHook('onClose', async () => clearInterval(sweep));

  const loadAll = async (db = pool) => {
    const [g, v] = await Promise.all([
      db.query('SELECT id, name, visible FROM video_groups ORDER BY sort, id'),
      db.query(`SELECT v.*, u.id AS up_id, u.size_bytes AS up_size, u.part_count AS up_parts
                  FROM videos v LEFT JOIN uploads u ON u.video_id = v.id AND u.status = 'active'
                 ORDER BY v.sort, v.id`),
    ]);
    return { groups: g.rows.map(groupView), videos: v.rows.map(videoView) };
  };

  // Ставит видео на место pos (0 = первым) внутри группы и перенумеровывает группу
  const place = async (c, videoId, groupId, pos) => {
    const ids = (await c.query('SELECT id FROM videos WHERE group_id = $1 AND id <> $2 ORDER BY sort, id', [groupId, videoId])).rows.map((r) => String(r.id));
    const at = Number.isInteger(pos) ? Math.max(0, Math.min(pos, ids.length)) : ids.length;
    ids.splice(at, 0, String(videoId));
    await c.query('UPDATE videos SET sort = x.n FROM unnest($1::bigint[]) WITH ORDINALITY AS x(id, n) WHERE videos.id = x.id', [ids]);
  };

  // ---------- Админка: список ----------
  app.get('/api/admin/videos', async (req, reply) => { noStore(reply); return loadAll(); });

  // ---------- Группы ----------
  const groupErr = (e, reply) => {
    if (e.code === '23505') return bad(reply, 409, 'Такая группа уже есть.');
    throw e;
  };
  app.post('/api/admin/video-groups', async (req, reply) => {
    const name = text(req.body?.name, 40);
    if (!name) return bad(reply, 400, 'Напиши название группы.');
    try {
      const id = await tx(pool, async (c) => {
        const r = await c.query(`INSERT INTO video_groups (name, visible, sort)
          VALUES ($1, $2, coalesce((SELECT max(sort) FROM video_groups), 0) + 1) RETURNING id`, [name, req.body?.visible !== false]);
        await audit(c, req.admin.id, 'group.create', { target: `group:${r.rows[0].id}`, meta: { name } });
        return r.rows[0].id;
      });
      return reply.code(201).send({ id: String(id) });
    } catch (e) { return groupErr(e, reply); }
  });

  app.patch('/api/admin/video-groups/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Группа не найдена');
    const b = req.body || {};
    try {
      return await tx(pool, async (c) => {
        const cur = (await c.query('SELECT * FROM video_groups WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!cur) return bad(reply, 404, 'Группа не найдена');
        const name = 'name' in b ? text(b.name, 40) : cur.name;
        if (!name) return bad(reply, 400, 'Напиши название группы.');
        const visible = 'visible' in b ? b.visible !== false : cur.visible;
        await c.query('UPDATE video_groups SET name = $2, visible = $3 WHERE id = $1', [id, name, visible]);
        await audit(c, req.admin.id, 'group.update', { target: `group:${id}`, meta: { name, visible } });
        return { ok: true };
      });
    } catch (e) { return groupErr(e, reply); }
  });

  app.post('/api/admin/video-groups/order', async (req, reply) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(idOf) : [];
    if (!ids.length || ids.includes(null)) return bad(reply, 400, 'Не тот порядок групп.');
    return tx(pool, async (c) => {
      const all = (await c.query('SELECT id FROM video_groups FOR UPDATE')).rows.map((r) => String(r.id));
      if (all.length !== ids.length || new Set(ids).size !== ids.length || !ids.every((i) => all.includes(i))) return bad(reply, 409, 'Список групп изменился. Обнови страницу.');
      await c.query('UPDATE video_groups SET sort = x.n FROM unnest($1::bigint[]) WITH ORDINALITY AS x(id, n) WHERE video_groups.id = x.id', [ids]);
      return { ok: true };
    });
  });

  app.delete('/api/admin/video-groups/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Группа не найдена');
    return tx(pool, async (c) => {
      const g = (await c.query('SELECT name FROM video_groups WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!g) return bad(reply, 404, 'Группа не найдена');
      const n = (await c.query('SELECT count(*)::int n FROM videos WHERE group_id = $1', [id])).rows[0].n;
      if (n) return bad(reply, 409, `В группе ещё ${n} видео. Сначала перенеси их в другую группу.`);
      await c.query('DELETE FROM video_groups WHERE id = $1', [id]);
      await audit(c, req.admin.id, 'group.delete', { target: `group:${id}`, meta: { name: g.name } });
      return { ok: true };
    });
  });

  // ---------- Карточка видео ----------
  const readCard = async (c, b, cur) => {
    const title = 'title' in b ? text(b.title, 80) : cur.title;
    if (!title) return { error: 'Напиши название, чтобы клиенты нашли видео.' };
    const groupId = 'groupId' in b ? idOf(b.groupId) : String(cur.group_id);
    if (!groupId || !(await c.query('SELECT 1 FROM video_groups WHERE id = $1', [groupId])).rowCount) return { error: 'Выбери группу.' };
    return {
      title, groupId,
      description: 'text' in b ? longText(b.text, 400) : cur.description,
      gear: 'gear' in b ? cleanGear(b.gear) : cur.gear,
      published: 'published' in b ? b.published === true : cur.published,
    };
  };

  app.post('/api/admin/videos', async (req, reply) => {
    const b = req.body || {};
    return tx(pool, async (c) => {
      const d = await readCard(c, b, { title: '', group_id: '', description: '', gear: [], published: false });
      if (d.error) return bad(reply, 400, d.error);
      // Новое видео всегда скрыто: файла ещё нет
      const r = await c.query(`INSERT INTO videos (title, group_id, description, gear, sort, status, published)
        VALUES ($1, $2, $3, $4, 0, 'empty', false) RETURNING id`, [d.title, d.groupId, d.description, d.gear]);
      const id = r.rows[0].id;
      await place(c, id, d.groupId, Number.isInteger(b.pos) ? b.pos : null);
      await audit(c, req.admin.id, 'video.create', { target: `video:${id}`, meta: { title: d.title } });
      return reply.code(201).send({ id: String(id) });
    });
  });

  app.patch('/api/admin/videos/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Видео не найдено');
    const b = req.body || {};
    return tx(pool, async (c) => {
      const cur = (await c.query('SELECT * FROM videos WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) return bad(reply, 404, 'Видео не найдено');
      const d = await readCard(c, b, cur);
      if (d.error) return bad(reply, 400, d.error);
      if (d.published && cur.status !== 'ready') return bad(reply, 409, 'Опубликовать можно, когда файл загрузится до конца.');
      await c.query(`UPDATE videos SET title = $2, group_id = $3, description = $4, gear = $5, published = $6, updated_at = now() WHERE id = $1`,
        [id, d.title, d.groupId, d.description, d.gear, d.published]);
      if ('pos' in b || d.groupId !== String(cur.group_id)) await place(c, id, d.groupId, Number.isInteger(b.pos) ? b.pos : null);
      const changed = d.published !== cur.published ? (d.published ? 'video.publish' : 'video.hide') : 'video.update';
      await audit(c, req.admin.id, changed, { target: `video:${id}`, meta: { title: d.title } });
      return { ok: true };
    });
  });

  app.post('/api/admin/videos/order', async (req, reply) => {
    const groupId = idOf(req.body?.groupId);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(idOf) : [];
    if (!groupId || !ids.length || ids.includes(null)) return bad(reply, 400, 'Не тот порядок видео.');
    return tx(pool, async (c) => {
      const all = (await c.query('SELECT id FROM videos WHERE group_id = $1 FOR UPDATE', [groupId])).rows.map((r) => String(r.id));
      if (all.length !== ids.length || new Set(ids).size !== ids.length || !ids.every((i) => all.includes(i))) return bad(reply, 409, 'Список видео изменился. Обнови страницу.');
      await c.query('UPDATE videos SET sort = x.n FROM unnest($1::bigint[]) WITH ORDINALITY AS x(id, n) WHERE videos.id = x.id', [ids]);
      return { ok: true };
    });
  });

  app.delete('/api/admin/videos/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Видео не найдено');
    const gone = await tx(pool, async (c) => {
      const v = (await c.query('SELECT * FROM videos WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!v) return null;
      const ups = (await c.query(`SELECT s3_key, s3_upload_id FROM uploads WHERE video_id = $1 AND status = 'active'`, [id])).rows;
      await c.query('DELETE FROM videos WHERE id = $1', [id]);
      await audit(c, req.admin.id, 'video.delete', { target: `video:${id}`, meta: { title: v.title } });
      return { key: v.s3_key, ups };
    });
    if (!gone) return bad(reply, 404, 'Видео не найдено');
    // Файлы удаляем после записи в базе: если хранилище не ответит, лишний файл уберёт уборка, а не клиент увидит пустое видео
    for (const u of gone.ups) await quietly(() => S3(new AbortMultipartUploadCommand({ Bucket: s3.bucket, Key: u.s3_key, UploadId: u.s3_upload_id })));
    if (gone.key) await quietly(() => S3(new DeleteObjectCommand({ Bucket: s3.bucket, Key: gone.key })));
    return { ok: true };
  });

  // Ника смотрит загруженный файл до публикации
  app.get('/api/admin/videos/:id/play', async (req, reply) => {
    noStore(reply);
    const id = idOf(req.params.id);
    const v = id && (await pool.query(`SELECT s3_key FROM videos WHERE id = $1 AND status = 'ready'`, [id])).rows[0];
    if (!v) return bad(reply, 404, 'Файла пока нет.');
    return { url: await playUrl(v.s3_key), expiresIn: PLAY_URL_TTL };
  });

  const playUrl = (key) => getSignedUrl(s3.signer, new GetObjectCommand({
    Bucket: s3.bucket, Key: key, ResponseContentType: 'video/mp4', ResponseCacheControl: 'private, no-store',
  }), { expiresIn: PLAY_URL_TTL });

  // ---------- Загрузка частями ----------
  // Начать или продолжить. Если для этого видео уже идёт загрузка того же файла, отдаём её: браузер докачает остаток.
  app.post('/api/admin/videos/:id/upload', async (req, reply) => {
    noStore(reply);
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Видео не найдено');
    const size = Number(req.body?.size);
    const type = String(req.body?.type || '');
    const fp = text(req.body?.fingerprint, 300);
    if (type !== 'video/mp4') return bad(reply, 400, 'Нужен файл MP4.');
    if (!Number.isSafeInteger(size) || size <= 0) return bad(reply, 400, 'Файл пустой.');
    if (size > MAX_SIZE) return bad(reply, 400, 'Файл больше 2 ГБ. Сожми его или раздели на части.');
    const partCount = Math.ceil(size / PART_SIZE);

    const prev = (await pool.query(`SELECT u.*, v.id AS vid FROM videos v LEFT JOIN uploads u ON u.video_id = v.id AND u.status = 'active' WHERE v.id = $1`, [id])).rows[0];
    if (!prev) return bad(reply, 404, 'Видео не найдено');
    if (prev.id && prev.file_fp === fp && Number(prev.size_bytes) === size && fp) {
      const parts = await listAllParts(s3, prev.s3_key, prev.s3_upload_id).catch(() => null);
      if (parts) return { uploadId: String(prev.id), partSize: prev.part_size, partCount: prev.part_count, done: parts.map((p) => p.n), resumed: true };
    }
    // Другой файл: старую загрузку отменяем
    if (prev.id) await abortUpload(prev, req.admin.id, 'replaced');

    const key = `video/${randomUUID()}.mp4`;
    const mp = await S3(new CreateMultipartUploadCommand({ Bucket: s3.bucket, Key: key, ContentType: 'video/mp4' }));
    try {
      const upId = await tx(pool, async (c) => {
        const r = await c.query(`INSERT INTO uploads (video_id, s3_upload_id, s3_key, size_bytes, part_size, part_count, file_fp, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [id, mp.UploadId, key, size, PART_SIZE, partCount, fp, req.admin.id]);
        await c.query(`UPDATE videos SET status = CASE WHEN status = 'ready' THEN 'ready' ELSE 'uploading' END, updated_at = now() WHERE id = $1`, [id]);
        return r.rows[0].id;
      });
      return { uploadId: String(upId), partSize: PART_SIZE, partCount, done: [], resumed: false };
    } catch (e) {
      await quietly(() => S3(new AbortMultipartUploadCommand({ Bucket: s3.bucket, Key: key, UploadId: mp.UploadId })));
      if (e.code === '23505') return bad(reply, 409, 'Загрузка уже началась в другой вкладке.');
      throw e;
    }
  });

  const activeUpload = async (rawId) => {
    const id = idOf(rawId);
    if (!id) return null;
    return (await pool.query(`SELECT * FROM uploads WHERE id = $1 AND status = 'active'`, [id])).rows[0] || null;
  };

  // Подписи для частей: пачкой, каждая на 15 минут
  app.post('/api/admin/uploads/:id/sign', async (req, reply) => {
    noStore(reply);
    const up = await activeUpload(req.params.id);
    if (!up) return bad(reply, 404, 'Загрузка не найдена. Начни заново.');
    const nums = Array.isArray(req.body?.parts) ? req.body.parts : [];
    if (!nums.length || nums.length > SIGN_BATCH || !nums.every((n) => Number.isInteger(n) && n >= 1 && n <= up.part_count)) return bad(reply, 400, 'Не те части.');
    const lk = `a${req.admin.id}`;
    if (signLimit.blocked(lk)) return bad(reply, 429, 'Слишком много запросов. Подожди немного.');
    signLimit.hit(lk);
    const urls = {};
    for (const n of new Set(nums)) {
      urls[n] = await getSignedUrl(s3.signer, new UploadPartCommand({ Bucket: s3.bucket, Key: up.s3_key, UploadId: up.s3_upload_id, PartNumber: n }), { expiresIn: PART_URL_TTL });
    }
    return { urls, expiresIn: PART_URL_TTL };
  });

  // Какие части уже лежат в хранилище (для продолжения)
  app.get('/api/admin/uploads/:id/parts', async (req, reply) => {
    noStore(reply);
    const up = await activeUpload(req.params.id);
    if (!up) return bad(reply, 404, 'Загрузка не найдена. Начни заново.');
    const parts = await listAllParts(s3, up.s3_key, up.s3_upload_id);
    return { partSize: up.part_size, partCount: up.part_count, sizeBytes: Number(up.size_bytes), done: parts.map((p) => p.n), doneBytes: parts.reduce((s, p) => s + p.size, 0) };
  });

  // Завершение: собираем файл, сверяем размер и что это действительно MP4
  app.post('/api/admin/uploads/:id/complete', async (req, reply) => {
    noStore(reply);
    const up = await activeUpload(req.params.id);
    if (!up) return bad(reply, 404, 'Загрузка не найдена. Начни заново.');
    const size = Number(up.size_bytes);
    const parts = await listAllParts(s3, up.s3_key, up.s3_upload_id);
    const total = parts.reduce((s, p) => s + p.size, 0);
    if (parts.length !== up.part_count || total !== size) {
      return bad(reply, 409, `Загружено ${parts.length} из ${up.part_count} частей. Продолжи загрузку.`);
    }
    const fail = async (why) => {
      await quietly(() => S3(new DeleteObjectCommand({ Bucket: s3.bucket, Key: up.s3_key })));
      await tx(pool, async (c) => {
        await c.query(`UPDATE uploads SET status = 'failed', finished_at = now() WHERE id = $1`, [up.id]);
        await c.query(`UPDATE videos SET status = CASE WHEN status = 'ready' THEN 'ready' ELSE 'failed' END, updated_at = now() WHERE id = $1`, [up.video_id]);
        await audit(c, req.admin.id, 'video.upload_failed', { target: `video:${up.video_id}`, meta: { why } });
      });
    };
    await S3(new CompleteMultipartUploadCommand({
      Bucket: s3.bucket, Key: up.s3_key, UploadId: up.s3_upload_id,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.n, ETag: p.etag })) },
    }));
    const head = await S3(new HeadObjectCommand({ Bucket: s3.bucket, Key: up.s3_key }));
    if (Number(head.ContentLength) !== size) {
      await fail('size');
      return bad(reply, 422, 'Файл собрался с другим размером. Загрузи его ещё раз.');
    }
    // У файла MP4 на 5–8 байте стоит метка ftyp. Чужой файл с подписью .mp4 не пропускаем.
    const headBytes = await S3(new GetObjectCommand({ Bucket: s3.bucket, Key: up.s3_key, Range: 'bytes=0-11' }));
    const sig = Buffer.from(await headBytes.Body.transformToByteArray()).subarray(4, 8).toString('latin1');
    if (sig !== 'ftyp') {
      await fail('not_mp4');
      return bad(reply, 422, 'Это не MP4. Сохрани видео в формате MP4 и загрузи снова.');
    }
    const oldKey = await tx(pool, async (c) => {
      const v = (await c.query('SELECT s3_key, title FROM videos WHERE id = $1 FOR UPDATE', [up.video_id])).rows[0];
      await c.query(`UPDATE uploads SET status = 'completed', finished_at = now() WHERE id = $1`, [up.id]);
      if (!v) return up.s3_key; // видео удалили во время загрузки: новый файл не нужен
      await c.query(`UPDATE videos SET s3_key = $2, size_bytes = $3, status = 'ready', updated_at = now() WHERE id = $1`, [up.video_id, up.s3_key, size]);
      await audit(c, req.admin.id, 'video.upload', { target: `video:${up.video_id}`, meta: { title: v.title, mb: Math.round(size / 1024 ** 2) } });
      return v.s3_key && v.s3_key !== up.s3_key ? v.s3_key : null;
    });
    if (oldKey) await quietly(() => S3(new DeleteObjectCommand({ Bucket: s3.bucket, Key: oldKey })));
    return { ok: true, sizeBytes: size };
  });

  const abortUpload = async (up, adminId, why) => {
    await quietly(() => S3(new AbortMultipartUploadCommand({ Bucket: s3.bucket, Key: up.s3_key, UploadId: up.s3_upload_id })));
    await tx(pool, async (c) => {
      await c.query(`UPDATE uploads SET status = 'aborted', finished_at = now() WHERE id = $1 AND status = 'active'`, [up.id]);
      await c.query(`UPDATE videos SET status = CASE WHEN status = 'ready' THEN 'ready' WHEN s3_key IS NULL THEN 'empty' ELSE status END, updated_at = now() WHERE id = $1`, [up.video_id]);
      if (adminId) await audit(c, adminId, 'video.upload_cancel', { target: `video:${up.video_id}`, meta: { why } });
    });
  };

  app.delete('/api/admin/uploads/:id', async (req, reply) => {
    const up = await activeUpload(req.params.id);
    if (!up) return bad(reply, 404, 'Загрузка не найдена.');
    await abortUpload(up, req.admin.id, 'cancel');
    return { ok: true };
  });

  // ---------- Кабинет клиента ----------
  // Список виден и без доступа (замки в библиотеке), сами файлы только с доступом
  app.get('/api/videos', { preHandler: app.requireUser }, async (req, reply) => {
    noStore(reply);
    const [g, v] = await Promise.all([
      pool.query('SELECT id, name FROM video_groups WHERE visible ORDER BY sort, id'),
      pool.query(`SELECT v.id, v.group_id, v.title, v.description, v.gear FROM videos v JOIN video_groups g ON g.id = v.group_id
                   WHERE v.published AND v.status = 'ready' AND g.visible ORDER BY g.sort, g.id, v.sort, v.id`),
    ]);
    return {
      groups: g.rows.map((r) => ({ id: String(r.id), name: r.name })),
      videos: v.rows.map((r) => ({ id: String(r.id), group: String(r.group_id), title: r.title, text: r.description, gear: r.gear || [] })),
    };
  });

  app.get('/api/videos/:id/play', { preHandler: app.requireUser }, async (req, reply) => {
    noStore(reply);
    const id = idOf(req.params.id);
    const key = `u${req.auth.id}`;
    if (playLimit.blocked(key)) return bad(reply, 429, 'Слишком много запросов. Подожди немного.');
    playLimit.hit(key);
    const v = id && (await pool.query(`SELECT v.s3_key FROM videos v JOIN video_groups g ON g.id = v.group_id
                                        WHERE v.id = $1 AND v.published AND v.status = 'ready' AND g.visible`, [id])).rows[0];
    if (!v) return bad(reply, 404, 'Видео не найдено');
    const ok = await pool.query(`SELECT 1 FROM access_periods WHERE user_id = $1 AND closed_at IS NULL AND starts_at <= now() AND ends_at > now() LIMIT 1`, [req.auth.id]);
    if (!ok.rowCount) return bad(reply, 403, 'Доступ к тренировкам закончился. Продли, чтобы смотреть.');
    return { url: await playUrl(v.s3_key), expiresIn: PLAY_URL_TTL };
  });
}
