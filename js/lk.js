/* Личный кабинет клиента. Экраны переключаются по hash: #/ #/video #/video/v01 #/extra #/profile.
   Срок доступа и оплаты приходят с сервера (/api/me/access), тренировки из /api/videos,
   само видео по ссылке на 5 минут (/api/videos/:id/play). Материалы пока демо (window.LK_DATA).
   Всё, что приходит из данных, вставляется через textContent. */
(() => {
  'use strict';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const DONE = 'nika_lk_done', LAST = 'nika_lk_last';
  const rd = k => { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (_) { return null; } };
  const wr = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  /* Вход проверяет сервер (HttpOnly-кука). Без сессии — на экран входа. */
  window.NikaApi.gate('user').then(me => { if (me) start(me); });
  async function start(me) {
  const D = window.LK_DATA;
  if (!D) return;
  D.client = { name: me.name, email: me.email };
  const [ar, vr] = await Promise.all([window.NikaApi.get('/api/me/access'), window.NikaApi.get('/api/videos')]);
  if (ar.status === 401 || vr.status === 401) { location.replace('login.html'); return; }
  D.groups = vr.ok ? vr.data.groups : [];
  D.videos = vr.ok ? vr.data.videos : [];
  const videosFailed = !vr.ok;
  const AC = ar.ok ? ar.data : null;   // null: сервер не ответил, показываем честное сообщение вместо выдуманного срока

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const icon = (id, cls) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id);
    s.appendChild(u); return s;
  };
  const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
  const fmt = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const fmtFull = iso => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  /* ---------- WhatsApp ---------- */
  const phone = (document.body.dataset.waPhone || '').replace(/\D/g, '');
  const waLink = (a, text) => { if (!a) return; a.href = phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text) : '#'; if (phone) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } };
  $$('[data-wa]').forEach(a => waLink(a, a.dataset.wa));

  /* ---------- Срок доступа ---------- */
  /* state с сервера: ok, warn, bad (закончился или закрыт), none (доступа ещё не было) */
  const sv = AC ? AC.state : 'none';
  const end = AC && AC.endsAt ? new Date(AC.endsAt) : null;
  const active = sv === 'ok' || sv === 'warn';
  const days = active ? AC.daysLeft : 0;
  const span = AC ? Math.max(1, AC.spanDays) : 1;
  const state = sv === 'none' ? 'bad' : sv;
  const locked = !active;
  const STAT = { ok: 'активен', warn: 'заканчивается', bad: 'закончился' };
  const label = sv === 'none' ? 'нет доступа' : (sv === 'bad' && AC.closed) ? 'закрыт' : STAT[state];
  const planLine = AC && AC.plan ? 'Тариф «' + AC.plan.name + '»' + (AC.plan.weeks ? ' · ' + AC.plan.weeks + ' ' + plural(AC.plan.weeks, 'неделя', 'недели', 'недель') : '') : '';
  const chip = (cls) => { const c = el('span', 'stat stat--' + state, label); if (cls) c.classList.add(cls); return c; };

  if (D.demo) $('[data-demo-bar]').hidden = false;   // материалы пока демо
  $$('[data-name]').forEach(n => { n.textContent = (D.client.name || '').split(' ')[0]; });   // в приветствии только имя, без фамилии

  const acc = $('[data-acc]');
  acc.classList.toggle('acc--bad', locked);
  $('[data-acc-kicker]').textContent = !AC ? 'не удалось узнать срок' : sv === 'none' ? 'доступа пока нет' : locked ? (AC.closed ? 'доступ закрыт' : 'доступ закончился') : 'доступ открыт до';
  $('[data-acc-date]').textContent = end && sv !== 'none' ? fmt(end) : '—';
  $('[data-acc-date]').hidden = !end || sv === 'none';
  const sub = $('[data-acc-sub]'); sub.textContent = '';
  sub.appendChild(chip());
  sub.appendChild(el('span', '', !AC ? 'обнови страницу' : sv === 'none' ? 'выбери тариф, чтобы открыть тренировки' : locked ? (AC.daysAgo ? AC.daysAgo + ' ' + plural(AC.daysAgo, 'день', 'дня', 'дней') + ' назад' : 'сегодня') : 'осталось ' + days + ' ' + plural(days, 'день', 'дня', 'дней')));
  $('[data-acc-plan]').textContent = planLine;
  const bar = $('[data-acc-bar]');
  const pct = Math.max(0, Math.min(100, Math.round(days / span * 100)));
  bar.setAttribute('aria-label', locked ? 'Доступа нет' : 'Осталось ' + pct + '% срока тарифа');
  $('[data-acc-renew]').textContent = sv === 'none' ? 'выбрать тариф' : locked ? 'продлить доступ' : 'продлить заранее';
  requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty('--p', pct)));

  const topChip = $('[data-stat-chip]');
  topChip.className = 'stat stat--' + state; topChip.textContent = label;

  /* ---------- Просмотрено / продолжить ---------- */
  const doneSet = () => { try { return new Set(JSON.parse(rd(DONE) || '[]')); } catch (_) { return new Set(); } };
  const saveDone = s => wr(DONE, JSON.stringify(Array.from(s)));
  const byId = id => D.videos.find(v => v.id === id);
  const gName = id => (D.groups.find(g => g.id === id) || {}).name || '';

  const renderContinue = () => {
    const box = $('[data-continue]');
    const done = doneSet();
    const last = byId(rd(LAST));
    const v = last || D.videos.find(x => !done.has(x.id));
    if (!v || locked) { box.hidden = true; return; }
    box.hidden = false;
    $('[data-cont-link]').href = '#/video/' + v.id;
    $('[data-cont-title]').textContent = v.title;
  };

  /* ---------- Группы мышц ---------- */
  const filt = { group: 'all', q: '' };

  /* ---------- Библиотека ---------- */
  const chips = $('[data-chips]'), grid = $('[data-vgrid]'), count = $('[data-count]'), empty = $('[data-empty]');
  const qInput = $('[data-q]');
  const drawChips = () => {
    chips.textContent = '';
    [{ id: 'all', name: 'Все' }].concat(D.groups).forEach(g => {
      const b = el('button', 'chip', g.name); b.type = 'button';
      b.setAttribute('aria-pressed', String(filt.group === g.id));
      b.addEventListener('click', () => { filt.group = g.id; drawLib(); });
      chips.appendChild(b);
    });
  };
  const card = v => {
    const li = el('li'); const a = el('a', 'vcard'); a.href = '#/video/' + v.id;
    const t = el('span', 'thumb'); t.setAttribute('aria-hidden', 'true');
    t.appendChild(icon('i-play', 'ic--play'));
    if (locked) { const b = el('span', 'badge badge--lock'); b.appendChild(icon('i-lock')); t.appendChild(b); }
    else if (doneSet().has(v.id)) { const b = el('span', 'badge badge--ok'); b.appendChild(icon('i-check')); b.appendChild(document.createTextNode('просмотрено')); t.appendChild(b); }
    const body = el('span', 'vcard__body');
    body.appendChild(el('span', 'vcard__t', v.title));
    body.appendChild(el('span', 'vcard__m', gName(v.group)));
    a.appendChild(t); a.appendChild(body); li.appendChild(a); return li;
  };
  const drawLib = () => {
    drawChips();
    const q = filt.q.trim().toLowerCase();
    const list = D.videos.filter(v => (filt.group === 'all' || v.group === filt.group) && (!q || (v.title + ' ' + gName(v.group)).toLowerCase().includes(q)));
    grid.textContent = ''; list.forEach(v => grid.appendChild(card(v)));
    count.textContent = list.length ? list.length + ' ' + plural(list.length, 'тренировка', 'тренировки', 'тренировок') : '';
    empty.hidden = list.length > 0; grid.hidden = !list.length;
    /* Пусто не из-за фильтра: тренировки не загрузились или Ника их ещё не опубликовала */
    const none = !D.videos.length;
    $('.empty__t', empty).textContent = videosFailed ? 'Не получилось загрузить тренировки' : none ? 'Тренировки скоро появятся' : 'Ничего не нашлось';
    $('.empty__p', empty).textContent = videosFailed ? 'Проверь интернет и обнови страницу.' : none ? 'Ника добавляет видео. Загляни чуть позже.' : 'Попробуй другое слово или сбрось фильтр.';
    $('[data-reset]').hidden = none;
    $('[data-search-form]').hidden = none; chips.hidden = none;
    $('[data-lock-note]').hidden = !locked;
  };
  qInput.addEventListener('input', () => { filt.q = qInput.value; drawLib(); });
  $('[data-search-form]').addEventListener('submit', e => e.preventDefault());
  $('[data-reset]').addEventListener('click', () => { filt.group = 'all'; filt.q = ''; qInput.value = ''; drawLib(); });

  /* ---------- Видео ---------- */
  const doneBtn = $('[data-done]');
  let cur = null;
  const drawWatch = id => {
    const v = byId(id);
    if (!v) { location.replace('#/video'); return null; }
    cur = v;
    if (!locked) wr(LAST, v.id);
    $('#h-watch').textContent = v.title;
    $('[data-w-meta]').textContent = gName(v.group);
    $('[data-w-text]').textContent = v.text;
    $('[data-w-gear]').textContent = v.gear.length ? 'Понадобится: ' + v.gear.join(', ') : '';
    $('[data-player]').hidden = locked; $('[data-locked]').hidden = !locked;
    resetPlayer();
    const isDone = doneSet().has(v.id);
    doneBtn.setAttribute('aria-pressed', String(isDone)); doneBtn.textContent = isDone ? 'просмотрено ✓' : 'отметить просмотренным';
    doneBtn.disabled = locked;
    waLink($('[data-w-ask]'), 'Здравствуйте, Ника! Вопрос по тренировке «' + v.title + '».');
    const i = D.videos.indexOf(v), pn = $('[data-pn]'); pn.textContent = '';
    [[D.videos[i - 1], 'назад'], [D.videos[i + 1], 'дальше']].forEach(([n, lab]) => {
      if (!n) return; const a = el('a'); a.href = '#/video/' + n.id;
      a.appendChild(el('small', '', lab)); a.appendChild(el('span', '', n.title)); pn.appendChild(a);
    });
    return v;
  };
  doneBtn.addEventListener('click', () => {
    if (!cur) return; const s = doneSet();
    s.has(cur.id) ? s.delete(cur.id) : s.add(cur.id); saveDone(s);
    doneBtn.setAttribute('aria-pressed', String(s.has(cur.id))); doneBtn.textContent = s.has(cur.id) ? 'просмотрено ✓' : 'отметить просмотренным';
  });
  /* ---------- Плеер ----------
     Ссылка на файл живёт 5 минут. Если она истекла посреди просмотра (перемотка, пауза), берём новую
     и продолжаем с того же места. */
  const playerBox = $('[data-player]'), playBtn = $('[data-play]'), note = $('[data-player-note]');
  let vidEl = null, playFor = null;
  const resetPlayer = () => { if (vidEl) { vidEl.removeAttribute('src'); vidEl.load(); vidEl.remove(); } vidEl = null; playFor = null; playBtn.hidden = false; note.textContent = ''; playerBox.classList.remove('is-on'); };
  const getUrl = async id => {
    const r = await window.NikaApi.get('/api/videos/' + id + '/play');
    if (r.status === 401) { location.replace('login.html'); return null; }
    if (!r.ok) { note.textContent = r.data.error; return null; }
    return r.data.url;
  };
  playBtn.addEventListener('click', async () => {
    if (!cur || locked) return;
    const id = cur.id; playBtn.disabled = true; note.textContent = 'Загружаю видео…';
    const url = await getUrl(id); playBtn.disabled = false;
    if (!url || !cur || cur.id !== id) return;
    note.textContent = ''; playBtn.hidden = true; playerBox.classList.add('is-on');
    const v = document.createElement('video');
    v.controls = true; v.playsInline = true; v.preload = 'metadata'; v.setAttribute('controlslist', 'nodownload');
    v.addEventListener('contextmenu', e => e.preventDefault());
    let retried = 0;
    v.addEventListener('error', async () => {
      if (retried >= 2 || playFor !== id) { note.textContent = 'Видео не загрузилось. Проверь интернет и обнови страницу.'; return; }
      retried++;
      const at = v.currentTime, fresh = await getUrl(id);
      if (!fresh || playFor !== id) return;
      v.src = fresh; v.currentTime = at; v.play().catch(() => {});
    });
    v.addEventListener('playing', () => { retried = 0; });
    v.src = url; vidEl = v; playFor = id; playerBox.appendChild(v);
    v.play().catch(() => {});
  });

  /* ---------- Материалы ---------- */
  const xl = $('[data-xlist]');
  D.extras.forEach(x => {
    const li = el('li', 'xcard');
    const img = el('img'); img.src = x.cover; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.width = 96; img.height = 120;
    const b = el('div', 'xcard__body');
    b.appendChild(el('span', 'xcard__k', x.kind));
    b.appendChild(el('span', 'xcard__t', x.title));
    if (x.owned) { b.appendChild(el('span', 'stat stat--ok', 'куплено')); const a = el('a', 'btn btn--red', 'открыть'); a.href = x.href; b.appendChild(a); }
    else { b.appendChild(el('span', 'xcard__k', x.price)); const a = el('a', 'btn btn--line-dark', 'забрать'); a.href = x.href; b.appendChild(a); }
    li.appendChild(img); li.appendChild(b); xl.appendChild(li);
  });

  /* ---------- Профиль ---------- */
  $('[data-p-name]').textContent = D.client.name;
  $('[data-p-email]').textContent = D.client.email;
  $('[data-p-plan]').textContent = !AC ? 'не удалось загрузить' : sv === 'none' ? 'пока нет' : '«' + (AC.plan ? AC.plan.name : '') + '», ' + (locked ? (AC.closed ? 'закрыт ' : 'закончился ') : 'до ') + fmt(end);
  const pay = $('[data-pay]');
  const pays = AC ? AC.payments : [];
  pays.forEach(p => { const li = el('li'); li.appendChild(el('span', '', p.title)); li.appendChild(el('span', 'pay__s', (p.sumKop / 100).toLocaleString('ru-RU') + ' ₽')); li.appendChild(el('span', 'pay__d', fmtFull(p.at))); pay.appendChild(li); });
  if (!pays.length) { const li = el('li', 'pay__e', 'Оплат пока нет.'); pay.appendChild(li); }
  /* ---------- Пароль для входа (необязательный) ----------
     ДЕМО: в браузере лежит только SHA-256. На сервере: хеш argon2id или bcrypt, лимит попыток, смена пароля
     только после ввода текущего или свежего кода из письма, после смены закрыть сессии на других устройствах. */
  (() => {
    const box = $('[data-pw]'); if (!box) return;
    const form = $('[data-pw-form]', box), actions = $('[data-pw-actions]', box), conf = $('[data-pw-confirm]', box);
    const chip = $('[data-pw-chip]', box), lead = $('[data-pw-lead]', box), msg = $('[data-pw-msg]', box), err = $('[data-pw-err]', box);
    const openBtn = $('[data-pw-open]', box), rmBtn = $('[data-pw-remove]', box);
    const p1 = $('[data-pw1]', box), p2 = $('[data-pw2]', box), eye = $('[data-pw-eye]', box);
    let hasPw = !!me.hasPassword;
    const has = () => hasPw;
    const COMMON = ['12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'password', 'password1', '11111111', '00000000', 'йцукенгш', 'qazwsxedc', '987654321'];
    const check = pw => {
      if (pw.length < 8) return 'Пароль короче 8 символов.';
      if (/^(.)\1+$/.test(pw) || COMMON.includes(pw.toLowerCase())) return 'Слишком простой пароль, такие подбирают первыми. Придумай другой.';
      const local = (D.client.email || '').split('@')[0].toLowerCase();
      if (local.length > 2 && pw.toLowerCase().includes(local)) return 'В пароле не должно быть части почты.';
      return '';
    };
    const draw = () => {
      const on = has();
      chip.hidden = !on;
      openBtn.textContent = on ? 'сменить пароль' : 'задать пароль';
      rmBtn.hidden = !on;
      lead.textContent = on ? 'Ты можешь входить по паролю. Если забудешь его, на экране входа нажми «не помню пароль»: придёт код.'
                            : 'Необязательно. Сейчас ты входишь по коду или ссылке из письма. Если удобнее пароль, задай его: код понадобится, только когда ты его забудешь.';
      $('[data-pw-l1]', box).textContent = on ? 'Новый пароль' : 'Пароль';
    };
    const reset = () => { form.reset(); err.textContent = ''; p1.removeAttribute('aria-invalid'); p2.removeAttribute('aria-invalid'); p1.type = 'password'; eye.textContent = 'показать'; eye.setAttribute('aria-pressed', 'false'); };
    const showForm = on => { form.hidden = !on; actions.hidden = on; conf.hidden = true; msg.textContent = ''; if (on) { reset(); p1.focus(); } };

    openBtn.addEventListener('click', () => showForm(true));
    $('[data-pw-cancel]', box).addEventListener('click', () => { showForm(false); openBtn.focus(); });
    eye.addEventListener('click', () => {
      const on = p1.type === 'password'; p1.type = on ? 'text' : 'password'; p2.type = p1.type;
      eye.textContent = on ? 'скрыть' : 'показать'; eye.setAttribute('aria-pressed', String(on)); eye.setAttribute('aria-label', on ? 'Скрыть пароль' : 'Показать пароль');
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const bad = check(p1.value) || (p1.value !== p2.value ? 'Пароли не совпадают.' : '');
      p1.removeAttribute('aria-invalid'); p2.removeAttribute('aria-invalid');
      if (bad) { err.textContent = bad; (p1.value !== p2.value && !check(p1.value) ? p2 : p1).setAttribute('aria-invalid', 'true'); (p1.value !== p2.value && !check(p1.value) ? p2 : p1).focus(); return; }
      const r = await window.NikaApi.put('/api/me/password', { password: p1.value });
      if (!r.ok) { err.textContent = r.data.error; p1.setAttribute('aria-invalid', 'true'); p1.focus(); return; }
      hasPw = true;
      reset(); showForm(false); draw(); msg.textContent = 'Пароль сохранён. На других устройствах выполнен выход.'; openBtn.focus();
    });
    rmBtn.addEventListener('click', () => { actions.hidden = true; conf.hidden = false; msg.textContent = ''; $('[data-pw-no]', box).focus(); });
    $('[data-pw-no]', box).addEventListener('click', () => { conf.hidden = true; actions.hidden = false; rmBtn.focus(); });
    $('[data-pw-yes]', box).addEventListener('click', async () => {
      const r = await window.NikaApi.del('/api/me/password');
      if (!r.ok) { conf.hidden = true; actions.hidden = false; msg.textContent = r.data.error; return; }
      hasPw = false;
      conf.hidden = true; actions.hidden = false; draw(); msg.textContent = 'Пароль убран. Вход по коду или ссылке из письма. На других устройствах выполнен выход.'; openBtn.focus();
    });
    draw();
  })();

  $('[data-logout]').addEventListener('click', () => window.NikaApi.logout('user'));

  /* ---------- Роутер ---------- */
  const views = $$('[data-view]');
  const TITLES = { access: 'Доступ', video: 'Тренировки', watch: 'Тренировка', extra: 'Материалы', profile: 'Профиль' };
  let first = true;
  const route = () => {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    let name = parts[0] || 'access';
    if (!TITLES[name] || name === 'watch') name = 'access';
    if (name === 'video' && parts[1]) { if (!drawWatch(parts[1])) return; name = 'watch'; }
    if (name === 'video') drawLib();
    if (name === 'access') renderContinue();
    views.forEach(v => { v.hidden = v.dataset.view !== name; });
    const navKey = name === 'watch' ? 'video' : name;
    $$('[data-nav]').forEach(a => { if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    topChip.hidden = name === 'access';
    document.title = TITLES[name] + ' — Ника Дупина';
    window.scrollTo(0, 0);
    if (!first) { const h = $('[data-view="' + name + '"] h1'); if (h) h.focus({ preventScroll: true }); }
    first = false;
  };
  window.addEventListener('hashchange', route);
  route();
}
})();
