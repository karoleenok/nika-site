import { newToken, hashToken, newCode, hashCode, sameBytes, normEmail, validEmail } from './crypto.js';
import { cookieName, cookieOptions, createSession, readSession, deleteSession, deleteOtherUserSessions } from './sessions.js';
import { hashPassword, checkPassword, burnTime, passwordProblem } from './password.js';
import { Limiter, CODE_LIMITS } from './limits.js';
import { loginCodeMail, passwordChangedMail } from '../mail.js';
import { tx } from '../db.js';

const CODE_TTL_MIN = 10, LINK_TTL_MIN = 15, CODE_MAX_ATTEMPTS = 5;
const GENERIC_PASS = 'Неверная почта или пароль. Можно войти по коду.';
const BAD_CODE = 'Код неверный или устарел. Запроси новый.';

const bad = (reply, status, error, extra = {}) => reply.code(status).send({ error, ...extra });
const kindOf = (v) => (v === 'admin' ? 'admin' : 'user');

export default async function authRoutes(app, { config, pool, mailer }) {
  const secure = config.publicUrl.startsWith('https://');
  const passByEmail = new Limiter({ max: 5, windowMs: 15 * 60e3 });
  const passByIp = new Limiter({ max: 20, windowMs: 15 * 60e3 });
  const sweep = setInterval(() => { passByEmail.sweep(); passByIp.sweep(); }, 60e3);
  sweep.unref();
  app.addHook('onClose', async () => clearInterval(sweep));

  const setCookie = (reply, kind, token, maxAgeMs) => reply.setCookie(cookieName(kind, secure), token, cookieOptions(secure, maxAgeMs));
  const clearCookie = (reply, kind) => reply.clearCookie(cookieName(kind, secure), cookieOptions(secure));

  // Кто сейчас вошёл. Ставится на каждый запрос к /api, лениво.
  app.decorateRequest('auth', null);
  async function load(req, reply, kind) {
    const token = req.cookies[cookieName(kind, secure)];
    const r = await readSession(pool, kind, token);
    if (!r) { if (token) clearCookie(reply, kind); return null; }
    if (r.refresh) setCookie(reply, kind, token, r.refresh);
    return { kind, id: r.session.owner_id, sessionId: r.session.id, token };
  }
  app.decorate('requireUser', async (req, reply) => {
    req.auth = await load(req, reply, 'user');
    if (!req.auth) return bad(reply, 401, 'Нужно войти');
  });
  app.decorate('requireAdmin', async (req, reply) => {
    req.auth = await load(req, reply, 'admin');
    if (!req.auth) return bad(reply, 401, 'Нужно войти');
    const { rows } = await pool.query('SELECT id, name, email, role FROM admins WHERE id = $1 AND active', [req.auth.id]);
    if (!rows[0]) return bad(reply, 401, 'Нужно войти');
    req.admin = rows[0];
  });

  // Все /api/admin/* только для админов — проверка на сервере, до любого обработчика
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/admin/')) return app.requireAdmin(req, reply);
  });

  async function startSession(db, reply, kind, id, remember) {
    const s = await createSession(db, { kind, id, persistent: !!remember });
    setCookie(reply, kind, s.token, s.maxAgeMs);
  }

  // ---------- 1. Получить код ----------
  app.post('/api/auth/code', async (req, reply) => {
    const email = normEmail(req.body?.email);
    const kind = kindOf(req.body?.kind);
    if (!validEmail(email)) return bad(reply, 400, 'Проверь почту: похоже, в адресе опечатка.');

    const ip = req.ip;
    const lim = await pool.query(
      `SELECT count(*) FILTER (WHERE email = $1 AND created_at > now() - interval '15 minutes')::int AS e15,
              count(*) FILTER (WHERE email = $1 AND created_at > now() - interval '1 day')::int AS eday,
              count(*) FILTER (WHERE ip = $2 AND created_at > now() - interval '15 minutes')::int AS ip15
         FROM login_codes WHERE (email = $1 OR ip = $2) AND created_at > now() - interval '1 day'`, [email, ip]);
    const { e15, eday, ip15 } = lim.rows[0];
    if (ip15 >= CODE_LIMITS.perIp15m) return bad(reply, 429, 'Слишком много запросов. Подожди 15 минут.');
    // Лимит на почту не раскрываем: ответ тот же, письмо просто не уходит
    if (e15 >= CODE_LIMITS.perEmail15m || eday >= CODE_LIMITS.perEmailDay) return { ok: true };

    const table = kind === 'admin' ? 'admins' : 'users';
    const exists = (await pool.query(`SELECT 1 FROM ${table} WHERE email = $1 ${kind === 'admin' ? 'AND active' : ''}`, [email])).rowCount > 0;
    const code = newCode();
    await tx(pool, async (c) => {
      // Старые коды этой почты гасим: действует только последний
      await c.query('UPDATE login_codes SET used_at = now() WHERE email = $1 AND kind = $2 AND used_at IS NULL', [email, kind]);
      await c.query(`INSERT INTO login_codes (email, kind, code_hash, expires_at, ip) VALUES ($1, $2, $3, now() + interval '${CODE_TTL_MIN} minutes', $4)`,
        [email, kind, hashCode(config.sessionSecret, email, code), ip]);
      if (!exists) return;
      let link = null;
      if (kind === 'user') {
        const t = newToken();
        await c.query('UPDATE login_tokens SET used_at = now() WHERE email = $1 AND kind = $2 AND used_at IS NULL', [email, kind]);
        await c.query(`INSERT INTO login_tokens (token_hash, email, kind, expires_at) VALUES ($1, $2, $3, now() + interval '${LINK_TTL_MIN} minutes')`,
          [hashToken(t), email, kind]);
        link = `${config.publicUrl}/lk/login.html?t=${t}`;
      }
      mailer.sendLater({ to: email, ...loginCodeMail({ code, link, admin: kind === 'admin' }) });
    });
    return { ok: true };
  });

  // ---------- 2. Ввести код ----------
  app.post('/api/auth/verify', async (req, reply) => {
    const email = normEmail(req.body?.email);
    const kind = kindOf(req.body?.kind);
    const code = String(req.body?.code ?? '');
    if (!validEmail(email) || !/^\d{6}$/.test(code)) return bad(reply, 400, 'Введи шесть цифр из письма.');

    return tx(pool, async (c) => {
      const { rows } = await c.query(
        `SELECT id, code_hash, attempts FROM login_codes
          WHERE email = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [email, kind]);
      const row = rows[0];
      if (!row || row.attempts >= CODE_MAX_ATTEMPTS) return bad(reply, 400, BAD_CODE);
      if (!sameBytes(row.code_hash, hashCode(config.sessionSecret, email, code))) {
        const left = CODE_MAX_ATTEMPTS - row.attempts - 1;
        await c.query(`UPDATE login_codes SET attempts = attempts + 1${left <= 0 ? ', used_at = now()' : ''} WHERE id = $1`, [row.id]);
        if (left <= 0) return bad(reply, 400, 'Слишком много попыток. Запроси новый код.', { attemptsLeft: 0 });
        return bad(reply, 400, `Неверный код. Осталось попыток: ${left}.`, { attemptsLeft: left });
      }
      await c.query('UPDATE login_codes SET used_at = now() WHERE id = $1', [row.id]);
      await c.query('UPDATE login_tokens SET used_at = now() WHERE email = $1 AND kind = $2 AND used_at IS NULL', [email, kind]);
      const table = kind === 'admin' ? 'admins' : 'users';
      const who = await c.query(`SELECT id FROM ${table} WHERE email = $1 ${kind === 'admin' ? 'AND active' : ''}`, [email]);
      if (!who.rows[0]) return bad(reply, 400, BAD_CODE);
      await startSession(c, reply, kind, who.rows[0].id, req.body?.remember);
      if (kind === 'admin') await c.query(`INSERT INTO audit_log (admin_id, action) VALUES ($1, 'login')`, [who.rows[0].id]);
      return { ok: true };
    });
  });

  // ---------- 3. Ссылка из письма ----------
  // check: true — только проверить, что ссылка жива (не тратит её). Вход — отдельным запросом по кнопке.
  app.post('/api/auth/link', async (req, reply) => {
    const t = String(req.body?.t ?? '');
    if (t.length < 40 || t.length > 100) return bad(reply, 400, 'Ссылка устарела или уже использована. Получи новый код.');
    return tx(pool, async (c) => {
      const { rows } = await c.query(
        `SELECT lt.id, u.id AS user_id FROM login_tokens lt JOIN users u ON u.email = lt.email
          WHERE lt.token_hash = $1 AND lt.kind = 'user' AND lt.used_at IS NULL AND lt.expires_at > now() FOR UPDATE OF lt`, [hashToken(t)]);
      if (!rows[0]) return bad(reply, 400, 'Ссылка устарела или уже использована. Получи новый код.');
      if (req.body?.check) return { ok: true };
      await c.query('UPDATE login_tokens SET used_at = now() WHERE id = $1', [rows[0].id]);
      await c.query(`UPDATE login_codes SET used_at = now() WHERE email = (SELECT email FROM users WHERE id = $1) AND kind = 'user' AND used_at IS NULL`, [rows[0].user_id]);
      await startSession(c, reply, 'user', rows[0].user_id, req.body?.remember);
      return { ok: true };
    });
  });

  // ---------- 4. Пароль ----------
  app.post('/api/auth/password', async (req, reply) => {
    const email = normEmail(req.body?.email);
    const pw = String(req.body?.password ?? '');
    if (!validEmail(email) || !pw || pw.length > 128) return bad(reply, 400, GENERIC_PASS);
    if (passByEmail.blocked(email) || passByIp.blocked(req.ip)) return bad(reply, 429, 'Слишком много попыток. Подожди 15 минут или войди по коду.');
    const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    const u = rows[0];
    const ok = u?.password_hash ? await checkPassword(u.password_hash, pw) : (await burnTime(pw), false);
    if (!ok) { passByEmail.hit(email); passByIp.hit(req.ip); return bad(reply, 400, GENERIC_PASS); }
    passByEmail.clear(email);
    await startSession(pool, reply, 'user', u.id, req.body?.remember);
    return { ok: true };
  });

  // ---------- 5. Выход ----------
  app.post('/api/auth/logout', async (req, reply) => {
    const kind = kindOf(req.body?.kind);
    const token = req.cookies[cookieName(kind, secure)];
    if (token) await deleteSession(pool, token);
    clearCookie(reply, kind);
    return { ok: true };
  });

  // ---------- Кто я ----------
  app.get('/api/me', { preHandler: app.requireUser }, async (req, reply) => {
    const { rows } = await pool.query('SELECT name, email, password_hash IS NOT NULL AS has_password FROM users WHERE id = $1', [req.auth.id]);
    reply.header('cache-control', 'no-store');
    return { name: rows[0].name, email: rows[0].email, hasPassword: rows[0].has_password };
  });

  app.get('/api/admin/me', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const { name, email, role } = req.admin;
    return { name, email, role };
  });

  // ---------- Пароль в профиле: задать / сменить / убрать ----------
  // После любого изменения: выход на других устройствах и письмо клиенту
  app.put('/api/me/password', { preHandler: app.requireUser }, async (req, reply) => {
    const pw = String(req.body?.password ?? '');
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [req.auth.id]);
    const problem = passwordProblem(pw, rows[0].email);
    if (problem) return bad(reply, 400, problem);
    const h = await hashPassword(pw);
    await tx(pool, async (c) => {
      await c.query('UPDATE users SET password_hash = $1 WHERE id = $2', [h, req.auth.id]);
      await deleteOtherUserSessions(c, req.auth.id, req.auth.sessionId);
    });
    mailer.sendLater({ to: rows[0].email, ...passwordChangedMail({ removed: false }) });
    return { ok: true };
  });

  app.delete('/api/me/password', { preHandler: app.requireUser }, async (req) => {
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [req.auth.id]);
    await tx(pool, async (c) => {
      await c.query('UPDATE users SET password_hash = NULL WHERE id = $1', [req.auth.id]);
      await deleteOtherUserSessions(c, req.auth.id, req.auth.sessionId);
    });
    mailer.sendLater({ to: rows[0].email, ...passwordChangedMail({ removed: true }) });
    return { ok: true };
  });
}

// Чистка просроченного: коды, ссылки, сессии
export async function cleanupAuth(pool) {
  await pool.query(`DELETE FROM login_codes  WHERE created_at < now() - interval '2 days'`);
  await pool.query(`DELETE FROM login_tokens WHERE created_at < now() - interval '2 days'`);
  await pool.query(`DELETE FROM sessions     WHERE expires_at < now()`);
}
