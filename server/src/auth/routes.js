import { openPassword } from './shown.js';
import { newToken, hashToken, newCode, hashCode, sameBytes, normEmail, validEmail } from './crypto.js';
import { cookieName, cookieOptions, createSession, readSession, deleteSession, deleteOtherUserSessions } from './sessions.js';
import { hashPassword, checkPassword, burnTime, passwordProblem } from './password.js';
import { Limiter, CODE_LIMITS, PASS_LIMITS } from './limits.js';
import { loginCodeMail, passwordChangedMail } from '../mail.js';
import { tx } from '../db.js';

const CODE_TTL_MIN = 10, LINK_TTL_MIN = 15, CODE_MAX_ATTEMPTS = 5;
const GENERIC_PASS = 'Неверная почта или пароль.';
const minutes = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'минуту' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'минуты' : 'минут'}`;
const BAD_CODE = 'Код неверный или устарел. Запроси новый.';

const bad = (reply, status, error, extra = {}) => reply.code(status).send({ error, ...extra });
const kindOf = (v) => (v === 'admin' ? 'admin' : 'user');

export default async function authRoutes(app, { config, pool, mailer }) {
  const secure = config.publicUrl.startsWith('https://');
  const passByPair = new Limiter(PASS_LIMITS.perPair);
  const passByIp = new Limiter(PASS_LIMITS.perIp);
  const passByEmail = new Limiter(PASS_LIMITS.perEmail);
  const sweep = setInterval(() => { passByPair.sweep(); passByIp.sweep(); passByEmail.sweep(); }, 60e3);
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

  // Что показывать на экране входа: если почта не настроена, клиент входит по почте и паролю от Ники
  app.get('/api/auth/config', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return { mail: config.mailOn };
  });

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
  // Клиент: необязательный пароль из профиля. Админ: основной способ входа (письма с кодом могут не ходить).
  app.post('/api/auth/password', async (req, reply) => {
    const email = normEmail(req.body?.email);
    const kind = kindOf(req.body?.kind);
    const pw = String(req.body?.password ?? '');
    if (!validEmail(email) || !pw || pw.length > 128) return bad(reply, 400, GENERIC_PASS);
    const pair = `${email}|${req.ip}`;
    const stop = [[passByPair, pair], [passByIp, req.ip], [passByEmail, email]].find(([l, k]) => l.blocked(k));
    if (stop) return bad(reply, 429, `Слишком много попыток. Подожди ${minutes(stop[0].waitMin(stop[1]))} и попробуй снова.`);
    const table = kind === 'admin' ? 'admins' : 'users';
    const { rows } = await pool.query(`SELECT id, password_hash FROM ${table} WHERE email = $1 ${kind === 'admin' ? 'AND active' : ''}`, [email]);
    const u = rows[0];
    const ok = u?.password_hash ? await checkPassword(u.password_hash, pw) : (await burnTime(pw), false);
    if (!ok) { passByPair.hit(pair); passByIp.hit(req.ip); passByEmail.hit(email); return bad(reply, 400, GENERIC_PASS); }
    passByPair.clear(pair);
    await tx(pool, async (c) => {
      await startSession(c, reply, kind, u.id, req.body?.remember);
      if (kind === 'admin') await c.query(`INSERT INTO audit_log (admin_id, action) VALUES ($1, 'login')`, [u.id]);
    });
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
    const { rows } = await pool.query('SELECT name, email, password_hash IS NOT NULL AS has_password, password_temp, password_shown FROM users WHERE id = $1', [req.auth.id]);
    const shown = rows[0].password_shown ? openPassword(config.sessionSecret, rows[0].password_shown) : null;
    reply.header('cache-control', 'no-store');
    // mustChangePassword: пароль выдала Ника, кабинет попросит придумать свой
    // passwordOnly: письма с кодом не ходят, пароль — единственный способ входа
    return { name: rows[0].name, email: rows[0].email, hasPassword: rows[0].has_password, mustChangePassword: rows[0].has_password && rows[0].password_temp, passwordOnly: !config.mailOn,
      // Пароль выдал сайт или Ника и почты нет: клиент видит его в профиле, свой задать пока нельзя
      shownPassword: shown, passwordLocked: !config.mailOn && !!shown && !rows[0].password_temp };
  });

  app.get('/api/admin/me', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const { rows } = await pool.query('SELECT tour_done_at IS NOT NULL AS tour_done FROM admins WHERE id = $1', [req.admin.id]);
    const { name, email, role } = req.admin;
    return { name, email, role, tourDone: rows[0].tour_done };
  });

  // ---------- Экскурсия по админке: отметка «пройдена» на сервере (для всех устройств) ----------
  app.put('/api/admin/tour', async (req, reply) => {
    if (typeof req.body?.done !== 'boolean') return bad(reply, 400, 'Нужно поле done: true или false.');
    const sql = req.body.done ? 'UPDATE admins SET tour_done_at = coalesce(tour_done_at, now()) WHERE id = $1' : 'UPDATE admins SET tour_done_at = NULL WHERE id = $1';
    await pool.query(sql, [req.admin.id]);
    reply.header('cache-control', 'no-store');
    return { tourDone: req.body.done };
  });

  // ---------- Смена пароля админа: нужен текущий пароль (или вход по коду, если пароля ещё нет) ----------
  app.put('/api/admin/password', async (req, reply) => {
    const cur = String(req.body?.current ?? ''), pw = String(req.body?.password ?? '');
    const { rows } = await pool.query('SELECT password_hash FROM admins WHERE id = $1', [req.admin.id]);
    if (rows[0].password_hash && !(await checkPassword(rows[0].password_hash, cur))) {
      if (passByIp.blocked(req.ip)) return bad(reply, 429, `Слишком много попыток. Подожди ${minutes(passByIp.waitMin(req.ip))}.`);
      passByIp.hit(req.ip);
      return bad(reply, 400, 'Текущий пароль неверный.');
    }
    const problem = passwordProblem(pw, req.admin.email);
    if (problem) return bad(reply, 400, problem);
    const h = await hashPassword(pw);
    await tx(pool, async (c) => {
      await c.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [h, req.admin.id]);
      await c.query('DELETE FROM sessions WHERE admin_id = $1 AND id <> $2', [req.admin.id, req.auth.sessionId]);
      await c.query(`INSERT INTO audit_log (admin_id, action) VALUES ($1, 'password_change')`, [req.admin.id]);
    });
    return { ok: true };
  });

  // ---------- Пароль в профиле: задать / сменить / убрать ----------
  // После любого изменения: выход на других устройствах и письмо клиенту
  app.put('/api/me/password', { preHandler: app.requireUser }, async (req, reply) => {
    const pw = String(req.body?.password ?? '');
    const { rows } = await pool.query('SELECT email, password_hash, password_temp, password_shown FROM users WHERE id = $1', [req.auth.id]);
    if (!config.mailOn && rows[0].password_shown && !rows[0].password_temp) return bad(reply, 400, 'Пока пароль сменить нельзя: он показан в профиле. Свой можно будет задать позже.');
    const problem = passwordProblem(pw, rows[0].email);
    if (problem) return bad(reply, 400, problem);
    // Временный пароль от Ники нельзя «сменить» на него же
    if (rows[0].password_temp && rows[0].password_hash && await checkPassword(rows[0].password_hash, pw)) return bad(reply, 400, 'Это пароль, который прислала Ника. Придумай свой.');
    const h = await hashPassword(pw);
    await tx(pool, async (c) => {
      await c.query('UPDATE users SET password_hash = $1, password_temp = false, password_shown = NULL WHERE id = $2', [h, req.auth.id]);
      await deleteOtherUserSessions(c, req.auth.id, req.auth.sessionId);
    });
    mailer.sendLater({ to: rows[0].email, ...passwordChangedMail({ removed: false }) });
    return { ok: true };
  });

  app.delete('/api/me/password', { preHandler: app.requireUser }, async (req, reply) => {
    // Без почты пароль — единственный вход: убрав его, клиент не сможет вернуться в кабинет
    if (!config.mailOn) return bad(reply, 400, 'Сейчас вход только по паролю, убрать его нельзя. Пароль можно сменить.');
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [req.auth.id]);
    await tx(pool, async (c) => {
      await c.query('UPDATE users SET password_hash = NULL, password_temp = false, password_shown = NULL WHERE id = $1', [req.auth.id]);
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
