// Материалы: гайды (PDF) и видео-разборы. Карточка и цена в базе, файл в S3.
// Файл грузится из браузера прямо в хранилище по подписанной ссылке, сервер потом сам проверяет,
// что пришло (размер и первые байты), и только тогда привязывает файл к материалу.
// Клиент получает файл по короткой подписанной ссылке и только если материал куплен или подарен.
import { randomUUID, randomBytes } from 'node:crypto';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { tx } from '../db.js';
import { audit } from '../access.js';
import { Limiter } from '../auth/limits.js';

export const MAX_FILE = 1024 ** 3;            // 1 ГБ: одним запросом, без частей
export const MAX_COVER = 600 * 1000;          // обложку браузер заранее сжимает, это потолок
export const UPLOAD_URL_TTL = 60 * 60;        // на загрузку большого файла час
export const OPEN_URL_TTL = 10 * 60;          // ссылка клиенту живёт 10 минут
export const GIFT_TARIFF = 'food-support';    // кому дарим материалы с галочкой «дарить»

// Что можно загрузить: тип, расширение и как файл начинается
const FILE_TYPES = {
  'application/pdf': { ext: 'pdf', ok: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'video/mp4': { ext: 'mp4', ok: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  'video/quicktime': { ext: 'mov', ok: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' || ['moov', 'mdat', 'wide', 'free'].includes(b.subarray(4, 8).toString('latin1')) },
  'video/webm': { ext: 'webm', ok: (b) => b.readUInt32BE(0) === 0x1a45dfa3 },
};
const EXT_TYPE = { pdf: 'application/pdf', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const COVER_TYPES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

const bad = (reply, status, error) => reply.code(status).send({ error });
const idOf = (v) => (/^\d{1,15}$/.test(String(v)) ? String(v) : null);
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const rub = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 1e6 ? n : null; };
// Имя файла для «Сохранить как»: без путей, кавычек и управляющих символов
const safeName = (v) => String(v ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>|*?:]/g, '').trim().slice(0, 120);
const disposition = (name, inline) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};
const coverLink = (r) => (r.cover_type ? `/api/materials/${r.id}/cover?v=${new Date(r.updated_at).getTime()}` : r.cover_url || null);
const tariffName = (kind, title) => `${kind.charAt(0).toUpperCase()}${kind.slice(1)} «${title}»`.slice(0, 200);

const SELECT = `SELECT m.id, m.kind, m.title, m.description, m.gift, m.cover_type, m.cover_url, m.page_url,
                       m.file_key, m.file_name, m.file_type, m.file_size, m.updated_at,
                       t.id AS tariff_id, t.slug, t.price_kop, t.old_price_kop, t.active, t.sort
                  FROM materials m JOIN tariffs t ON t.id = m.tariff_id`;

const adminView = (r) => ({
  id: String(r.id), slug: r.slug, kind: r.kind, title: r.title, text: r.description,
  price: Math.round(r.price_kop / 100), old: Math.round(r.old_price_kop / 100), on: r.active, gift: r.gift,
  cover: coverLink(r), page: r.page_url || null,
  file: r.file_key ? { name: r.file_name, type: r.file_type, sizeBytes: Number(r.file_size) } : null,
  sales: r.sales ?? 0,
});

const quietly = async (fn) => { try { await fn(); } catch { /* уже удалено или не было */ } };

export default async function materialRoutes(app, { pool, s3 }) {
  const noStore = (reply) => reply.header('cache-control', 'no-store');
  const S3 = (cmd) => s3.internal.send(cmd);
  const openLimit = new Limiter({ max: 60, windowMs: 60 * 60 * 1000 });
  const sweep = setInterval(() => openLimit.sweep(), 10 * 60 * 1000);
  sweep.unref();
  app.addHook('onClose', async () => clearInterval(sweep));
  const moneyRole = (req) => req.admin.role === 'owner' || req.admin.role === 'tech';
  const one = async (db, id, lock = false) => (await db.query(`${SELECT} WHERE m.id = $1${lock ? ' FOR UPDATE OF m' : ''}`, [id])).rows[0];

  // ---------- Админка ----------
  app.get('/api/admin/materials', async (req, reply) => {
    noStore(reply);
    const { rows } = await pool.query(`${SELECT.replace('FROM materials m', ', (SELECT count(*)::int FROM purchases p WHERE p.tariff_id = t.id) AS sales FROM materials m')} ORDER BY t.sort, m.id`);
    return { materials: rows.map(adminView) };
  });

  // Поля карточки из запроса. Цены меняют только Ника и Каролина.
  const fields = (req, cur) => {
    const b = req.body || {};
    const kind = 'kind' in b ? text(b.kind, 30) : cur?.kind ?? 'гайд';
    const title = 'title' in b ? text(b.title, 90) : cur?.title ?? '';
    if (!kind) return { error: 'Выбери тип материала.' };
    if (!title) return { error: 'Напиши название материала.' };
    const price = 'price' in b ? rub(b.price) : cur ? Math.round(cur.price_kop / 100) : 0;
    const old = 'old' in b ? rub(b.old ?? 0) : cur ? Math.round(cur.old_price_kop / 100) : 0;
    if (price === null || old === null) return { error: 'Цена: целое число рублей.' };
    if (old && old <= price) return { error: 'Старая цена должна быть выше новой, иначе скидки нет.' };
    const priceChanged = !cur ? price !== 0 || old !== 0 : price * 100 !== cur.price_kop || old * 100 !== cur.old_price_kop;
    if (priceChanged && !moneyRole(req)) return { error: 'Цены меняют Ника и Каролина.', status: 403 };
    return {
      kind, title, price, old,
      text: 'text' in b ? longText(b.text, 300) : cur?.description ?? '',
      on: 'on' in b ? b.on === true : cur ? cur.active : false,
      gift: 'gift' in b ? b.gift === true : cur ? cur.gift : false,
    };
  };

  app.post('/api/admin/materials', async (req, reply) => {
    const f = fields(req, null);
    if (f.error) return bad(reply, f.status || 400, f.error);
    const id = await tx(pool, async (c) => {
      const slug = `m-${randomBytes(5).toString('hex')}`;
      const t = await c.query(`INSERT INTO tariffs (slug, kind, grp, name, price_kop, old_price_kop, sort, active)
        VALUES ($1, 'material', 'Материалы', $2, $3, $4, coalesce((SELECT max(sort) FROM tariffs WHERE kind = 'material'), 19) + 1, $5) RETURNING id`,
      [slug, tariffName(f.kind, f.title), f.price * 100, f.old * 100, f.on]);
      const m = await c.query('INSERT INTO materials (tariff_id, kind, title, description, gift) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [t.rows[0].id, f.kind, f.title, f.text, f.gift]);
      await audit(c, req.admin.id, 'material.create', { target: `material:${m.rows[0].id}`, meta: { title: f.title } });
      return m.rows[0].id;
    });
    return reply.code(201).send({ material: adminView(await one(pool, id)) });
  });

  app.patch('/api/admin/materials/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Материал не найден');
    const out = await tx(pool, async (c) => {
      const cur = await one(c, id, true);
      if (!cur) return { status: 404, error: 'Материал не найден' };
      const f = fields(req, cur);
      if (f.error) return { status: f.status || 400, error: f.error };
      if (f.on && !cur.file_key && !cur.page_url) return { status: 400, error: 'Сначала загрузи файл: без него клиенту нечего открыть.' };
      await c.query('UPDATE materials SET kind = $2, title = $3, description = $4, gift = $5, updated_at = now() WHERE id = $1', [id, f.kind, f.title, f.text, f.gift]);
      await c.query('UPDATE tariffs SET name = $2, price_kop = $3, old_price_kop = $4, active = $5 WHERE id = $1',
        [cur.tariff_id, tariffName(f.kind, f.title), f.price * 100, f.old * 100, f.on]);
      await audit(c, req.admin.id, 'material.update', { target: `material:${id}`, meta: { title: f.title, on: f.on } });
      return null;
    });
    if (out) return bad(reply, out.status, out.error);
    return { material: adminView(await one(pool, id)) };
  });

  app.delete('/api/admin/materials/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Материал не найден');
    const out = await tx(pool, async (c) => {
      const cur = await one(c, id, true);
      if (!cur) return { status: 404, error: 'Материал не найден' };
      const used = (await c.query('SELECT 1 FROM orders WHERE tariff_id = $1 LIMIT 1', [cur.tariff_id])).rowCount;
      if (used) return { status: 409, error: 'Этот материал уже покупали, удалить нельзя: у клиентов пропадёт покупка. Выключи «Показывать клиентам».' };
      await c.query('DELETE FROM purchases WHERE tariff_id = $1', [cur.tariff_id]);
      await c.query('DELETE FROM tariffs WHERE id = $1', [cur.tariff_id]);   // карточка удалится каскадом
      await audit(c, req.admin.id, 'material.delete', { target: `material:${id}`, meta: { title: cur.title } });
      return { keys: [cur.file_key, cur.pending_key].filter(Boolean) };
    });
    if (out.error) return bad(reply, out.status, out.error);
    for (const Key of out.keys) await quietly(() => S3(new DeleteObjectCommand({ Bucket: s3.bucket, Key })));
    return { ok: true };
  });

  // Обложка: браузер уже сжал картинку, присылает base64. Храним в базе, отдаём сами (без хранилища и CSP-исключений).
  app.put('/api/admin/materials/:id/cover', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Материал не найден');
    const type = String(req.body?.type ?? ''), data = String(req.body?.data ?? '');
    if (!COVER_TYPES[type] || !/^[A-Za-z0-9+/]+=*$/.test(data)) return bad(reply, 400, 'Обложка: подойдёт JPG, PNG или WebP.');
    const buf = Buffer.from(data, 'base64');
    if (buf.length < 12 || buf.length > MAX_COVER) return bad(reply, 400, 'Картинка слишком большая. Выбери другую.');
    if (!COVER_TYPES[type](buf)) return bad(reply, 400, 'Это не похоже на картинку. Выбери JPG, PNG или WebP.');
    const r = await pool.query('UPDATE materials SET cover = $2, cover_type = $3, updated_at = now() WHERE id = $1 RETURNING id', [id, buf, type]);
    if (!r.rowCount) return bad(reply, 404, 'Материал не найден');
    await audit(pool, req.admin.id, 'material.cover', { target: `material:${id}` });
    return { material: adminView(await one(pool, id)) };
  });

  // Файл, шаг 1: подписанная ссылка на загрузку одним запросом
  app.post('/api/admin/materials/:id/file', async (req, reply) => {
    noStore(reply);
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Материал не найден');
    const name = safeName(req.body?.name), size = Number(req.body?.size);
    const ext = (name.match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase();
    const type = EXT_TYPE[ext];
    if (!name || !type) return bad(reply, 400, 'Подойдёт PDF или видео MP4, MOV, WebM.');
    if (!Number.isInteger(size) || size <= 0) return bad(reply, 400, 'Файл пустой.');
    if (size > MAX_FILE) return bad(reply, 400, 'Файл больше 1 ГБ. Сожми видео или раздели на части.');
    const old = (await pool.query('SELECT pending_key FROM materials WHERE id = $1', [id])).rows[0];
    if (!old) return bad(reply, 404, 'Материал не найден');
    const key = `materials/${id}/${randomUUID()}.${FILE_TYPES[type].ext}`;
    await pool.query('UPDATE materials SET pending_key = $2 WHERE id = $1', [id, key]);
    if (old.pending_key) await quietly(() => S3(new DeleteObjectCommand({ Bucket: s3.bucket, Key: old.pending_key })));
    const url = await getSignedUrl(s3.signer, new PutObjectCommand({ Bucket: s3.bucket, Key: key, ContentType: type }), { expiresIn: UPLOAD_URL_TTL });
    return { url, headers: { 'Content-Type': type }, name, type, size };
  });

  // Файл, шаг 2: проверяем, что дошло, и привязываем
  app.post('/api/admin/materials/:id/file/done', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Материал не найден');
    const name = safeName(req.body?.name);
    const cur = (await pool.query('SELECT pending_key, file_key FROM materials WHERE id = $1', [id])).rows[0];
    if (!cur) return bad(reply, 404, 'Материал не найден');
    if (!cur.pending_key) return bad(reply, 409, 'Загрузка не найдена. Выбери файл ещё раз.');
    const key = cur.pending_key;
    const type = EXT_TYPE[key.split('.').pop()] || 'application/octet-stream';
    let head;
    try { head = await S3(new HeadObjectCommand({ Bucket: s3.bucket, Key: key })); }
    catch { return bad(reply, 409, 'Файл не дошёл до хранилища. Попробуй ещё раз.'); }
    const size = Number(head.ContentLength);
    let first = Buffer.alloc(0);
    try {
      const g = await S3(new GetObjectCommand({ Bucket: s3.bucket, Key: key, Range: 'bytes=0-15' }));
      first = Buffer.from(await g.Body.transformToByteArray());
    } catch { /* проверка ниже не пройдёт */ }
    const fail = async (msg) => {
      await quietly(() => S3(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key })));
      await pool.query('UPDATE materials SET pending_key = NULL WHERE id = $1 AND pending_key = $2', [id, key]);
      return bad(reply, 400, msg);
    };
    if (!size || size > MAX_FILE) return fail('Файл больше 1 ГБ или пустой.');
    if (first.length < 8 || !FILE_TYPES[type].ok(first)) return fail('Файл не похож на PDF или видео. Проверь, что выбрала нужный.');
    const r = await pool.query(`UPDATE materials SET file_key = $2, file_name = $3, file_type = $4, file_size = $5, pending_key = NULL, updated_at = now()
                                 WHERE id = $1 AND pending_key = $2 RETURNING id`, [id, key, name || `material.${FILE_TYPES[type].ext}`, type, size]);
    if (!r.rowCount) return bad(reply, 409, 'Пока шла загрузка, выбрали другой файл. Обнови страницу.');
    if (cur.file_key && cur.file_key !== key) await quietly(() => S3(new DeleteObjectCommand({ Bucket: s3.bucket, Key: cur.file_key })));
    await audit(pool, req.admin.id, 'material.file', { target: `material:${id}`, meta: { name, size } });
    return { material: adminView(await one(pool, id)) };
  });

  // Админ смотрит загруженный файл
  app.get('/api/admin/materials/:id/open', async (req, reply) => {
    noStore(reply);
    const id = idOf(req.params.id);
    const m = id && await one(pool, id);
    if (!m) return bad(reply, 404, 'Материал не найден');
    if (!m.file_key) return m.page_url ? { url: m.page_url } : bad(reply, 404, 'Файл ещё не загружен.');
    return { url: await signOpen(m) };
  });

  const signOpen = (m) => getSignedUrl(s3.signer, new GetObjectCommand({
    Bucket: s3.bucket, Key: m.file_key,
    ResponseContentType: m.file_type,
    ResponseContentDisposition: disposition(m.file_name || 'material', true),
    ResponseCacheControl: 'private, no-store',
  }), { expiresIn: OPEN_URL_TTL });

  // ---------- Публично: обложка ----------
  app.get('/api/materials/:id/cover', async (req, reply) => {
    const id = idOf(req.params.id);
    const r = id && (await pool.query(`SELECT m.cover, m.cover_type FROM materials m WHERE m.id = $1 AND m.cover IS NOT NULL`, [id])).rows[0];
    if (!r) return bad(reply, 404, 'Не найдено');
    reply.header('content-type', r.cover_type).header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'");
    return reply.send(r.cover);
  });

  // ---------- Кабинет клиента ----------
  const ownedSql = `EXISTS (SELECT 1 FROM purchases p WHERE p.user_id = $1 AND p.tariff_id = t.id)
                 OR (m.gift AND EXISTS (SELECT 1 FROM orders o JOIN tariffs g ON g.id = o.tariff_id WHERE o.user_id = $1 AND g.slug = '${GIFT_TARIFF}' AND o.status IN ('paid','manual')))`;

  app.get('/api/me/materials', { preHandler: app.requireUser }, async (req, reply) => {
    noStore(reply);
    const { rows } = await pool.query(`${SELECT.replace('FROM materials m', `, (${ownedSql}) AS owned, EXISTS (SELECT 1 FROM purchases p WHERE p.user_id = $1 AND p.tariff_id = t.id) AS bought FROM materials m`)}
      WHERE t.active OR (${ownedSql}) ORDER BY t.sort, m.id`, [req.auth.id]);
    return {
      materials: rows.map((r) => ({
        id: String(r.id), slug: r.slug, kind: r.kind, title: r.title, text: r.description, cover: coverLink(r),
        price: Math.round(r.price_kop / 100), old: Math.round(r.old_price_kop / 100), owned: r.owned,
        gift: r.owned && !r.bought,   // открыт подарком к «Сопровождению по питанию», а не покупкой
        ready: !!(r.file_key || r.page_url), fileType: r.owned ? r.file_type || null : null,
      })),
    };
  });

  app.get('/api/me/materials/:id/open', { preHandler: app.requireUser }, async (req, reply) => {
    noStore(reply);
    const id = idOf(req.params.id);
    if (!id) return bad(reply, 404, 'Материал не найден');
    const key = `u${req.auth.id}`;
    if (openLimit.blocked(key)) return bad(reply, 429, `Слишком часто. Попробуй через ${openLimit.waitMin(key)} мин.`);
    openLimit.hit(key);
    const m = (await pool.query(`${SELECT.replace('FROM materials m', `, (${ownedSql}) AS owned FROM materials m`)} WHERE m.id = $2`, [req.auth.id, id])).rows[0];
    if (!m) return bad(reply, 404, 'Материал не найден');
    if (!m.owned) return bad(reply, 403, 'Этот материал ещё не куплен.');
    if (m.file_key) return { url: await signOpen(m), type: m.file_type };
    if (m.page_url) return { url: m.page_url, type: 'page' };
    return bad(reply, 404, 'Ника ещё загружает этот материал. Загляни позже.');
  });
}
