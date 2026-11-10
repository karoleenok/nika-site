/* Личный кабинет клиента. Экраны переключаются по hash: #/ #/video #/video/v01 #/extra #/profile.
   Данные берутся из window.LK_DATA (демо). Всё, что приходит из данных, вставляется через textContent. */
(() => {
  'use strict';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const KEY = 'nika_lk_session', DONE = 'nika_lk_done', LAST = 'nika_lk_last';
  const rd = k => { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (_) { return null; } };
  const wr = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  /* ДЕМО-вход: настоящая сессия будет HttpOnly-cookie от сервера */
  if (!rd(KEY)) { location.replace('login.html'); return; }
  const D = window.LK_DATA;
  if (!D) return;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const icon = (id, cls) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id);
    s.appendChild(u); return s;
  };
  const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
  const fmt = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const fmtFull = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  /* ---------- WhatsApp ---------- */
  const phone = (document.body.dataset.waPhone || '').replace(/\D/g, '');
  const waLink = (a, text) => { if (!a) return; a.href = phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text) : '#'; if (phone) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } };
  $$('[data-wa]').forEach(a => waLink(a, a.dataset.wa));

  /* ---------- Срок доступа ---------- */
  const demoState = new URLSearchParams(location.search).get('demo');
  const days = { active: 34, soon: 3, expired: -3 }[demoState] ?? 34;
  const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + days);
  const span = D.plan.span;
  const state = days <= 0 ? 'bad' : days <= 7 ? 'warn' : 'ok';
  const locked = state === 'bad';
  const STAT = { ok: 'активен', warn: 'заканчивается', bad: 'закончился' };
  const chip = (cls) => { const c = el('span', 'stat stat--' + state, STAT[state]); if (cls) c.classList.add(cls); return c; };

  if (D.demo) $('[data-demo-bar]').hidden = false;
  $$('[data-name]').forEach(n => { n.textContent = D.client.name; });

  const acc = $('[data-acc]');
  acc.classList.toggle('acc--bad', locked);
  $('[data-acc-kicker]').textContent = locked ? 'доступ закончился' : 'доступ открыт до';
  $('[data-acc-date]').textContent = fmt(end);
  const sub = $('[data-acc-sub]'); sub.textContent = '';
  sub.appendChild(chip());
  sub.appendChild(el('span', '', locked ? Math.abs(days) + ' ' + plural(Math.abs(days), 'день', 'дня', 'дней') + ' назад' : 'осталось ' + days + ' ' + plural(days, 'день', 'дня', 'дней')));
  $('[data-acc-plan]').textContent = 'Тариф «' + D.plan.name + '»' + (D.plan.weeks ? ' · ' + D.plan.weeks + ' ' + plural(D.plan.weeks, 'неделя', 'недели', 'недель') : '');
  const bar = $('[data-acc-bar]');
  const pct = Math.max(0, Math.min(100, Math.round(days / span * 100)));
  bar.setAttribute('aria-label', locked ? 'Доступ закончился' : 'Осталось ' + pct + '% срока тарифа');
  $('[data-acc-renew]').textContent = locked ? 'продлить доступ' : 'продлить заранее';
  requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty('--p', pct)));

  const topChip = $('[data-stat-chip]');
  topChip.className = 'stat stat--' + state; topChip.textContent = STAT[state];

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
    $('[data-cont-meta]').textContent = gName(v.group) + ' · ' + v.min + ' мин';
    $('[data-cont-title]').textContent = v.title;
  };

  /* ---------- Группы мышц ---------- */
  const filt = { group: 'all', q: '' };
  const tiles = $('[data-tiles]');
  D.groups.forEach(g => {
    const n = D.videos.filter(v => v.group === g.id).length;
    const li = el('li'); const a = el('a', 'tile'); a.href = '#/video';
    a.appendChild(el('span', 'tile__n', g.name));
    a.appendChild(el('span', 'tile__c', n + ' ' + plural(n, 'тренировка', 'тренировки', 'тренировок')));
    a.addEventListener('click', () => { filt.group = g.id; filt.q = ''; $('[data-q]').value = ''; });
    li.appendChild(a); tiles.appendChild(li);
  });

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
    const dur = el('span', 'badge badge--t', v.min + ' мин'); t.appendChild(dur);
    if (locked) { const b = el('span', 'badge badge--lock'); b.appendChild(icon('i-lock')); t.appendChild(b); }
    else if (doneSet().has(v.id)) { const b = el('span', 'badge badge--ok'); b.appendChild(icon('i-check')); b.appendChild(document.createTextNode('просмотрено')); t.appendChild(b); }
    const body = el('span', 'vcard__body');
    body.appendChild(el('span', 'vcard__t', v.title));
    body.appendChild(el('span', 'vcard__m', gName(v.group) + ' · ' + v.level));
    a.appendChild(t); a.appendChild(body); li.appendChild(a); return li;
  };
  const drawLib = () => {
    drawChips();
    const q = filt.q.trim().toLowerCase();
    const list = D.videos.filter(v => (filt.group === 'all' || v.group === filt.group) && (!q || (v.title + ' ' + gName(v.group)).toLowerCase().includes(q)));
    grid.textContent = ''; list.forEach(v => grid.appendChild(card(v)));
    count.textContent = list.length ? list.length + ' ' + plural(list.length, 'тренировка', 'тренировки', 'тренировок') : '';
    empty.hidden = list.length > 0; grid.hidden = !list.length;
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
    $('[data-w-meta]').textContent = gName(v.group) + ' · ' + v.min + ' мин · ' + v.level;
    $('[data-w-text]').textContent = v.text;
    $('[data-w-gear]').textContent = 'Понадобится: ' + v.gear.join(', ');
    $('[data-player]').hidden = locked; $('[data-locked]').hidden = !locked;
    $('[data-player-note]').textContent = 'Здесь будет видео. Подключим, когда выберем хранилище.';
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
  $('[data-play]').addEventListener('click', () => { $('[data-player-note]').textContent = 'Это демо: видео пока нет.'; });

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
  $('[data-p-plan]').textContent = '«' + D.plan.name + '», ' + (locked ? 'закончился ' : 'до ') + fmt(end);
  const pay = $('[data-pay]');
  D.payments.forEach(p => { const li = el('li'); li.appendChild(el('span', '', p.title)); li.appendChild(el('span', 'pay__s', p.sum)); li.appendChild(el('span', 'pay__d', fmtFull(p.date))); pay.appendChild(li); });
  $('[data-logout]').addEventListener('click', () => { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (_) {} location.replace('login.html'); });

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
})();
