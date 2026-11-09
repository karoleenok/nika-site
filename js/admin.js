/* Админка Ники. Экраны по hash: #/ #/clients #/client/ID #/video #/leads #/more #/telegram #/prices #/log.
   ДЕМО: данные в памяти, после обновления страницы сбрасываются (кроме настроек Telegram).
   Всё из данных вставляется через textContent. */
(() => {
  'use strict';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const KEY = 'nika_admin_session', TGK = 'nika_admin_tg';
  const rd = k => { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (_) { return null; } };
  const wr = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  if (!rd(KEY)) { location.replace('login.html'); return; }   // ДЕМО: настоящая сессия — HttpOnly-кука + 2FA
  const L = window.LK_DATA, A = window.ADMIN_DATA;
  if (!L || !A) return;

  /* ---------- Помощники ---------- */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const icon = (id, cls) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s;
  };
  const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
  const dayWord = n => n + ' ' + plural(n, 'день', 'дня', 'дней');
  const fmt = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
  const first = name => name.split(' ')[0];

  /* ---------- Состояние ---------- */
  const clients = A.clients.map(c => ({ ...c, until: addDays(today, c.days), reminded: false, closed: false }));
  const log = A.log.map(x => ({ ...x }));
  const leads = A.leads.map(x => ({ ...x }));
  const videos = L.videos.map((v, i) => ({ ...v, on: true, order: i }));
  const tariffs = A.tariffs.map(t => ({ ...t }));
  const left = c => Math.round((c.until - today) / 864e5);
  const stateOf = c => { const d = left(c); return d <= 0 ? 'bad' : d <= 7 ? 'warn' : 'ok'; };
  const STAT = { ok: 'активен', warn: 'заканчивается', bad: 'закончился' };
  const byId = id => clients.find(c => c.id === id);
  const addLog = (cid, text, note) => log.unshift({ cid, when: 'сейчас', who: 'Ника', text, note: note || '' });
  const sorted = () => clients.slice().sort((a, b) => left(a) - left(b));
  const statText = c => { const d = left(c); return d <= 0 ? (c.closed ? 'закрыт вручную' : 'закончился ' + (d === 0 ? 'сегодня' : dayWord(-d) + ' назад')) : 'до ' + fmt(c.until) + ' · ' + dayWord(d); };
  let tg = { on: false, user: '', sw: { purchase: true, lead: true, expiring: true, expired: true, digest: false }, days: [7, 3, 1], time: '09:00', email: true };
  try { const s = JSON.parse(rd(TGK) || 'null'); if (s) tg = { ...tg, ...s }; } catch (_) {}
  const saveTg = () => wr(TGK, JSON.stringify(tg));

  if (L.demo) $('[data-demo-bar]').hidden = false;

  /* ---------- Тост с отменой ---------- */
  const toastEl = $('[data-toast]'), toastT = $('[data-toast-t]'), toastB = $('[data-toast-b]');
  let tTimer = 0, tUndo = null;
  const toast = (msg, label, fn) => {
    clearTimeout(tTimer); toastT.textContent = msg; tUndo = fn || null;
    toastB.hidden = !fn; toastB.textContent = label || '';
    toastEl.hidden = false; toastEl.style.animation = 'none'; void toastEl.offsetWidth; toastEl.style.animation = '';
    tTimer = setTimeout(() => { toastEl.hidden = true; tUndo = null; }, fn ? 7000 : 3500);
  };
  toastB.addEventListener('click', () => { const f = tUndo; toastEl.hidden = true; tUndo = null; if (f) f(); });

  /* ---------- Диалоги ---------- */
  const dlg = n => $('[data-dlg="' + n + '"]');
  const openDlg = n => { const d = dlg(n); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); return d; };
  $$('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    $$('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close()));
  });

  /* ---------- Связь с клиентом (в демо телефона нет, показываем текст) ---------- */
  const contact = (c, text) => {
    if (c.phone) { window.open('https://wa.me/' + c.phone.replace(/\D/g, '') + '?text=' + encodeURIComponent(text), '_blank', 'noopener'); return; }
    toast('Демо: откроется WhatsApp с текстом «' + text + '»');
  };
  const remindText = c => 'Привет, ' + first(c.name) + '! ' + (left(c) <= 0 ? 'Твой доступ к тренировкам закончился ' + fmt(c.until) + '.' : 'Твой доступ к тренировкам заканчивается ' + fmt(c.until) + '.') + ' Продлить можно здесь: ' + A.siteUrl + '#services. Если нужна помощь, напиши.';
  const remind = c => { contact(c, remindText(c)); c.reminded = true; addLog(c.id, 'Напомнила ' + c.name + ' о продлении'); };

  /* ---------- Сегодня ---------- */
  const kpiLink = (href, n, label, cls, filter) => {
    const li = el('li'); const a = el('a', 'kpi' + (cls ? ' kpi--' + cls : '')); a.href = href;
    a.appendChild(el('span', 'kpi__n', String(n))); a.appendChild(el('span', 'kpi__l', label));
    a.addEventListener('click', () => { if (filter) cf.f = filter; });
    li.appendChild(a); return li;
  };
  const drawToday = () => {
    $('[data-date]').textContent = today.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    const act = clients.filter(c => left(c) > 0).length, warn = clients.filter(c => stateOf(c) === 'warn').length, bad = clients.filter(c => stateOf(c) === 'bad').length, nl = leads.filter(l => l.isNew).length;
    const k = $('[data-kpis]'); k.textContent = '';
    k.appendChild(kpiLink('#/clients', act, 'клиентов с доступом', '', 'all'));
    k.appendChild(kpiLink('#/clients', warn, 'доступ скоро закончится', warn ? 'warn' : '', 'warn'));
    k.appendChild(kpiLink('#/clients', bad, 'доступ закончился', bad ? 'bad' : '', 'bad'));
    k.appendChild(kpiLink('#/leads', nl, nl === 1 ? 'новая заявка' : 'новые заявки', '', null));
    $('[data-tgban]').hidden = tg.on;
    const todo = clients.filter(c => stateOf(c) !== 'ok').sort((a, b) => left(a) - left(b));
    const box = $('[data-todo]'); box.textContent = '';
    todo.forEach(c => {
      const st = stateOf(c), li = el('li', 'row row--todo');
      li.appendChild(el('span', 'ava ava--' + st, c.name[0]));
      const b = el('a', 'row__b'); b.href = '#/client/' + c.id;
      b.appendChild(el('span', 'row__n', c.name)); b.appendChild(el('span', 'row__s', c.plan + ' · ' + statText(c)));
      li.appendChild(b);
      const act = el('div', 'row__act');
      if (c.reminded) act.appendChild(el('span', 'done', ''));
      if (c.reminded) { const d = act.firstChild; d.appendChild(icon('i-check')); d.appendChild(document.createTextNode('напомнила')); }
      else act.appendChild(el('span'));
      const bt = el('button', 'btn ' + (c.reminded ? 'btn--line-dark' : 'btn--red'), c.reminded ? 'ещё раз' : 'напомнить'); bt.type = 'button';
      bt.addEventListener('click', () => { remind(c); drawToday(); });
      act.appendChild(bt); li.appendChild(act); box.appendChild(li);
    });
    $('[data-todo-empty]').hidden = todo.length > 0;
    const pl = $('[data-purchases]'); pl.textContent = '';
    A.purchases.forEach(p => { const li = el('li'); li.appendChild(el('span', '', p.client + ' · ' + p.title)); li.appendChild(el('span', 'pay__s', p.sum)); li.appendChild(el('span', 'pay__d', p.ago)); pl.appendChild(li); });
  };

  /* ---------- Клиенты ---------- */
  const cf = { f: 'all', q: '' };
  const FIL = [['all', 'Все'], ['ok', 'Активные'], ['warn', 'Заканчивается'], ['bad', 'Закончился']];
  const drawClients = () => {
    const chips = $('[data-cl-chips]'); chips.textContent = '';
    FIL.forEach(([id, name]) => { const b = el('button', 'chip', name); b.type = 'button'; b.setAttribute('aria-pressed', String(cf.f === id)); b.addEventListener('click', () => { cf.f = id; drawClients(); }); chips.appendChild(b); });
    const q = cf.q.trim().toLowerCase();
    const list = sorted().filter(c => (cf.f === 'all' || stateOf(c) === cf.f) && (!q || c.name.toLowerCase().includes(q)));
    const ul = $('[data-cl-list]'); ul.textContent = '';
    list.forEach(c => {
      const st = stateOf(c), li = el('li'); const a = el('a', 'row'); a.href = '#/client/' + c.id;
      a.appendChild(el('span', 'ava ava--' + st, c.name[0]));
      const d = left(c);
      const b = el('span', 'row__b'); b.appendChild(el('span', 'row__n', c.name));
      b.appendChild(el('span', 'row__s', c.plan + ' · ' + (st === 'bad' ? (d === 0 ? 'закончился сегодня' : dayWord(-d) + ' назад') : 'до ' + fmt(c.until)))); a.appendChild(b);
      const r = el('span', 'row__r'); r.appendChild(el('span', 'stat stat--' + st, st === 'bad' ? (c.closed ? 'закрыт' : 'закончился') : dayWord(d))); a.appendChild(r);
      li.appendChild(a); ul.appendChild(li);
    });
    $('[data-cl-count]').textContent = list.length ? list.length + ' ' + plural(list.length, 'клиент', 'клиента', 'клиентов') : '';
    $('[data-cl-empty]').hidden = list.length > 0; ul.hidden = !list.length;
  };
  $('[data-cl-q]').addEventListener('input', e => { cf.q = e.target.value; drawClients(); });
  $('[data-cl-form]').addEventListener('submit', e => e.preventDefault());
  $('[data-cl-reset]').addEventListener('click', () => { cf.f = 'all'; cf.q = ''; $('[data-cl-q]').value = ''; drawClients(); });

  /* ---------- Карточка клиента ---------- */
  let cur = null;
  const drawClient = id => {
    const c = byId(id); if (!c) { location.replace('#/clients'); return false; }
    cur = c; const st = stateOf(c);
    const ava = $('[data-c-ava]'); ava.className = 'ava ava--lg ava--' + st; ava.textContent = c.name[0];
    $('#h-client').textContent = c.name; $('[data-c-plan]').textContent = 'Тариф «' + c.plan + '»';
    $('[data-c-acc]').classList.toggle('acc--bad', st === 'bad');
    $('[data-c-kicker]').textContent = st === 'bad' ? (c.closed ? 'доступ закрыт' : 'доступ закончился') : 'доступ открыт до';
    $('[data-c-date]').textContent = fmt(c.until);
    const sub = $('[data-c-sub]'); sub.textContent = ''; sub.appendChild(el('span', 'stat stat--' + st, STAT[st])); sub.appendChild(el('span', '', statText(c).replace(/^до [^·]+· /, '')));
    $('[data-c-extend]').textContent = st === 'bad' ? 'открыть снова' : 'продлить';
    $('[data-c-close]').hidden = st === 'bad';
    $('[data-c-remind]').textContent = c.reminded ? 'напомнить ещё раз' : 'напомнить о продлении';
    $('[data-c-remind]').hidden = st === 'ok';
    $('[data-c-note]').value = c.note || '';
    const h = $('[data-c-hist]'); h.textContent = '';
    const mine = log.filter(x => x.cid === c.id);
    if (!mine.length) h.appendChild(el('li', 'hist__e', 'Пока ничего не менялось.'));
    mine.forEach(x => h.appendChild(histItem(x, false)));
    return true;
  };
  const histItem = (x, who) => { const li = el('li'); li.appendChild(el('span', '', x.text)); if (x.note) li.appendChild(el('span', 'hist__n', 'Заметка: ' + x.note)); li.appendChild(el('span', 'hist__w', x.when + (who ? ' · ' + x.who : ''))); return li; };
  $('[data-c-note]').addEventListener('change', e => { if (cur) { cur.note = e.target.value.trim(); toast('Заметка сохранена'); } });
  $('[data-c-remind]').addEventListener('click', () => { if (cur) { remind(cur); drawClient(cur.id); } });
  $('[data-c-wa]').addEventListener('click', () => { if (cur) contact(cur, 'Привет, ' + first(cur.name) + '!'); });

  /* Продлить / открыть */
  const OPTS = [['+7 дней', 7, 0], ['+14 дней', 14, 0], ['+1 месяц', 0, 1], ['+2 месяца', 0, 2], ['+4 месяца', 0, 4]];
  const fx = $('[data-form="extend"]'), optBox = $('[data-dx-opts]'), newLine = $('[data-dx-new]');
  const base = c => (c.until > today ? c.until : today);
  const pick = () => { const r = $('input:checked', optBox); const o = OPTS[Number(r ? r.value : 2)]; return o; };
  const newDate = () => { const o = pick(); return o[1] ? addDays(base(cur), o[1]) : addMonths(base(cur), o[2]); };
  const drawNew = () => { newLine.textContent = 'Доступ будет открыт до ' + fmt(newDate()); };
  OPTS.forEach((o, i) => {
    const l = el('label', 'pill'); const r = el('input'); r.type = 'radio'; r.name = 'span'; r.value = String(i); if (i === 2) r.checked = true;
    r.addEventListener('change', drawNew); l.appendChild(r); l.appendChild(el('span', '', o[0])); optBox.appendChild(l);
  });
  const openExtend = () => {
    if (!cur) return; const bad = stateOf(cur) === 'bad';
    $('[data-dx-title]').textContent = bad ? 'Открыть доступ' : 'Продлить доступ';
    $('[data-dx-ok]').textContent = bad ? 'открыть' : 'продлить';
    $('[data-dx-who]').textContent = cur.name + ', тариф «' + cur.plan + '»';
    $('[data-dx-note]').value = ''; $$('input', optBox)[2].checked = true; drawNew(); openDlg('extend');
  };
  $('[data-c-extend]').addEventListener('click', openExtend);
  fx.addEventListener('submit', e => {
    e.preventDefault(); const c = cur, prev = { until: c.until, closed: c.closed }, nd = newDate(), note = $('[data-dx-note]').value.trim();
    c.until = nd; c.closed = false; addLog(c.id, (stateOf(c) === 'ok' || prev.until > today ? 'Продлила' : 'Открыла') + ' доступ ' + c.name + ' до ' + fmt(nd), note);
    dlg('extend').close(); drawClient(c.id);
    toast('Доступ до ' + fmt(nd), 'отменить', () => { c.until = prev.until; c.closed = prev.closed; log.shift(); if (cur === c && location.hash.startsWith('#/client/')) drawClient(c.id); toast('Отменено'); });
  });

  /* Закрыть */
  $('[data-c-close]').addEventListener('click', () => { if (!cur) return; $('[data-dc-text]').textContent = cur.name + ' перестанет открывать видео. Данные и история останутся, открыть доступ можно в любой момент.'; openDlg('close'); });
  $('[data-form="close"]').addEventListener('submit', e => {
    e.preventDefault(); const c = cur, prev = { until: c.until, closed: c.closed };
    c.until = addDays(today, -1); c.closed = true; addLog(c.id, 'Закрыла доступ ' + c.name);
    dlg('close').close(); drawClient(c.id);
    toast('Доступ закрыт', 'отменить', () => { c.until = prev.until; c.closed = prev.closed; log.shift(); if (cur === c && location.hash.startsWith('#/client/')) drawClient(c.id); toast('Отменено'); });
  });

  /* ---------- Видео ---------- */
  let vg = 'all';
  const gName = id => (L.groups.find(g => g.id === id) || {}).name || '';
  const drawVideo = () => {
    const chips = $('[data-v-chips]'); chips.textContent = '';
    [{ id: 'all', name: 'Все' }].concat(L.groups).forEach(g => { const b = el('button', 'chip', g.name); b.type = 'button'; b.setAttribute('aria-pressed', String(vg === g.id)); b.addEventListener('click', () => { vg = g.id; drawVideo(); }); chips.appendChild(b); });
    const all = videos.slice().sort((a, b) => a.order - b.order);
    const list = all.filter(v => vg === 'all' || v.group === vg);
    $('[data-v-count]').textContent = list.length + ' ' + plural(list.length, 'видео', 'видео', 'видео') + ' · скрытые не видны клиентам';
    const ul = $('[data-v-list]'); ul.textContent = '';
    list.forEach((v, i) => {
      const li = el('li', 'vrow' + (v.on ? '' : ' is-off'));
      const b = el('div'); b.appendChild(el('p', 'vrow__n', v.title)); b.appendChild(el('p', 'vrow__s', gName(v.group) + (v.processing ? ' · обрабатывается' : ' · ' + v.min + ' мин') + (v.on ? '' : ' · скрыто')));
      const c = el('div', 'vrow__c');
      const mv = (dir, icn, lab, dis) => { const x = el('button', 'ibtn'); x.type = 'button'; x.setAttribute('aria-label', lab + ': ' + v.title); x.disabled = dis; x.appendChild(icon(icn)); x.addEventListener('click', () => { const j = all.indexOf(v), o = all[j + dir]; if (!o) return; const t = v.order; v.order = o.order; o.order = t; drawVideo(); }); return x; };
      c.appendChild(mv(-1, 'i-up', 'Выше', all.indexOf(v) === 0)); c.appendChild(mv(1, 'i-down', 'Ниже', all.indexOf(v) === all.length - 1));
      const sw = el('input', 'sw'); sw.type = 'checkbox'; sw.setAttribute('role', 'switch'); sw.checked = v.on; sw.setAttribute('aria-label', 'Показывать клиентам: ' + v.title);
      sw.addEventListener('change', () => { v.on = sw.checked; drawVideo(); toast(v.on ? 'Видео снова видно клиентам' : 'Видео скрыто от клиентов'); });
      c.appendChild(sw); li.appendChild(b); li.appendChild(c); ul.appendChild(li);
    });
  };
  const dg = $('[data-du-group]'); L.groups.forEach(g => { const o = el('option', '', g.name); o.value = g.id; dg.appendChild(o); });
  $('[data-v-add]').addEventListener('click', () => { $('[data-form="upload"]').reset(); $('[data-du-err]').textContent = ''; openDlg('upload'); });
  $('[data-form="upload"]').addEventListener('submit', e => {
    e.preventDefault(); const t = $('[data-du-title]').value.trim();
    if (!t) { $('[data-du-err]').textContent = 'Напиши название, чтобы клиенты нашли видео.'; $('[data-du-title]').focus(); return; }
    videos.push({ id: 'n' + Date.now(), group: dg.value, title: t, min: 0, level: '', gear: [], text: '', on: true, order: videos.length, processing: true });
    dlg('upload').close(); vg = 'all'; drawVideo(); toast('Видео добавлено (демо)');
  });

  /* ---------- Заявки ---------- */
  const drawLeads = () => {
    const ul = $('[data-leads]'); ul.textContent = '';
    leads.forEach(l => {
      const li = el('li', 'lead'); const h = el('div', 'lead__h');
      h.appendChild(el('span', 'lead__n', l.name)); if (l.isNew) h.appendChild(el('span', 'stat stat--new', 'новая')); h.appendChild(el('span', 'lead__m', l.via + ' · ' + l.when));
      li.appendChild(h); li.appendChild(el('p', 'lead__t', l.text));
      if (l.quiz) {
        const q = el('div', 'lead__q'); l.quiz.forEach(x => q.appendChild(el('span', '', x))); li.appendChild(q);
        const a = el('div', 'lead__a', 'Предварительно: ' + l.analyses.join(', ') + '.'); a.appendChild(el('small', '', 'Список составил тест, направление подтверждаешь ты.')); li.appendChild(a);
      }
      const act = el('div', 'lead__act');
      const w = el('button', 'btn btn--red', 'ответить в WhatsApp'); w.type = 'button'; w.addEventListener('click', () => contact({ name: l.name }, 'Здравствуй, ' + l.name + '! Это Ника. Получила твою заявку.')); act.appendChild(w);
      if (l.isNew) { const d = el('button', 'btn btn--line-dark', 'отметить обработанной'); d.type = 'button'; d.addEventListener('click', () => { l.isNew = false; drawLeads(); updateDot(); toast('Заявка обработана'); }); act.appendChild(d); }
      li.appendChild(act); ul.appendChild(li);
    });
  };
  const updateDot = () => { $('[data-leads-dot]').hidden = !leads.some(l => l.isNew); };

  /* ---------- Telegram ---------- */
  const SW = [['purchase', 'Новая покупка', 'Кто и что купил'], ['lead', 'Новая заявка', 'С сайта, из теста и формы'], ['expiring', 'Доступ заканчивается', 'За несколько дней до конца'], ['expired', 'Доступ закончился', 'В день окончания'], ['digest', 'Утренняя сводка', 'Один раз в день: кому писать сегодня']];
  const drawTg = () => {
    $('[data-tg-off]').hidden = tg.on; $('[data-tg-on]').hidden = !tg.on; $('[data-tg-user]').textContent = tg.user;
    $('[data-menu-tg]').textContent = tg.on ? 'подключено ' + tg.user : 'не подключено';
    const ul = $('[data-tg-sw]'); ul.textContent = '';
    SW.forEach(([k, t, s]) => {
      const li = el('li'); const l = el('label', 'sw-row'); const x = el('span', 'sw-row__t'); x.appendChild(el('b', '', t)); x.appendChild(el('small', '', s));
      const i = el('input', 'sw'); i.type = 'checkbox'; i.setAttribute('role', 'switch'); i.checked = !!tg.sw[k];
      i.addEventListener('change', () => { tg.sw[k] = i.checked; saveTg(); $('[data-tg-days-box]').hidden = !(tg.sw.expiring || tg.sw.digest); });
      l.appendChild(x); l.appendChild(i); li.appendChild(l); ul.appendChild(li);
    });
    $('[data-tg-days-box]').hidden = !(tg.sw.expiring || tg.sw.digest);
    const d = $('[data-tg-days]'); d.textContent = '';
    [7, 3, 1].forEach(n => { const l = el('label', 'pill'); const i = el('input'); i.type = 'checkbox'; i.checked = tg.days.includes(n); i.addEventListener('change', () => { tg.days = [7, 3, 1].filter(x => (x === n ? i.checked : tg.days.includes(x))); saveTg(); }); l.appendChild(i); l.appendChild(el('span', '', 'за ' + dayWord(n))); d.appendChild(l); });
    $('[data-tg-time]').value = tg.time; $('[data-tg-email]').checked = !!tg.email;
  };
  $('[data-tg-connect]').addEventListener('click', e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'ждём нажатия Start…';
    /* ДЕМО. Настоящая ссылка: https://t.me/<бот>?start=<одноразовый токен от сервера>, статус приходит от бота */
    toast('Демо: откроется t.me/' + A.botName + ' с одноразовым кодом');
    setTimeout(() => { tg.on = true; tg.user = '@nika_dupina'; saveTg(); b.disabled = false; b.textContent = 'подключить Telegram'; drawTg(); toast('Telegram подключён'); }, 1600);
  });
  $('[data-tg-test]').addEventListener('click', () => toast('Тестовое сообщение отправлено (демо)'));
  $('[data-tg-off]').addEventListener('click', () => { const prev = { ...tg }; tg.on = false; tg.user = ''; saveTg(); drawTg(); toast('Telegram отключён', 'вернуть', () => { tg = prev; saveTg(); drawTg(); }); });
  $('[data-tg-time]').addEventListener('change', e => { tg.time = e.target.value || '09:00'; saveTg(); });
  $('[data-tg-email]').addEventListener('change', e => { tg.email = e.target.checked; saveTg(); });

  /* ---------- Цены ---------- */
  const drawPrices = () => {
    const f = $('[data-prices]'); f.textContent = '';
    tariffs.forEach(t => {
      const box = el('div', 'tcard'); box.appendChild(el('p', 'tcard__n', t.name));
      const g = el('div', 'tcard__f');
      const fld = (lab, val, name) => { const l = el('label', 'field'); l.appendChild(el('span', 'field__label', lab)); const i = el('input', 'field__input'); i.type = 'text'; i.inputMode = 'numeric'; i.value = val || ''; i.name = name; i.autocomplete = 'off'; l.appendChild(i); return [l, i]; };
      const [l1, i1] = fld('Цена, ₽', t.price, 'price'), [l2, i2] = fld('Старая цена, ₽', t.old, 'old');
      g.appendChild(l1); g.appendChild(l2); box.appendChild(g);
      const err = el('p', 'field__err'); err.setAttribute('role', 'alert'); box.appendChild(err);
      const act = el('div', 'tcard__act'); const sv = el('button', 'btn btn--red', 'сохранить'); sv.type = 'submit'; act.appendChild(sv); box.appendChild(act);
      box.addEventListener('submit', e => e.preventDefault());
      sv.addEventListener('click', e => {
        e.preventDefault(); const p = Number(i1.value.replace(/\D/g, '')), o = i2.value.trim() ? Number(i2.value.replace(/\D/g, '')) : 0;
        i1.removeAttribute('aria-invalid'); i2.removeAttribute('aria-invalid'); err.textContent = '';
        if (!p) { err.textContent = 'Укажи цену цифрами.'; i1.setAttribute('aria-invalid', 'true'); i1.focus(); return; }
        if (o && o <= p) { err.textContent = 'Старая цена должна быть выше новой, иначе скидки нет.'; i2.setAttribute('aria-invalid', 'true'); i2.focus(); return; }
        t.price = p; t.old = o; i1.value = p; i2.value = o || ''; addLog(null, 'Изменила цену «' + t.name + '»: ' + p.toLocaleString('ru-RU') + ' ₽'); toast('Цена «' + t.name + '» сохранена');
      });
      f.appendChild(box);
    });
  };

  /* ---------- Журнал ---------- */
  const drawLog = () => { const ul = $('[data-log]'); ul.textContent = ''; log.forEach(x => ul.appendChild(histItem(x, true))); };

  /* ---------- Выход ---------- */
  $$('[data-logout]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (_) {} location.replace('login.html'); }));

  /* ---------- Роутер ---------- */
  const views = $$('[data-view]');
  const NAV = { today: 'today', clients: 'clients', client: 'clients', video: 'video', leads: 'leads', more: 'more', telegram: 'more', prices: 'more', log: 'more' };
  const TITLES = { today: 'Сегодня', clients: 'Клиенты', client: 'Клиент', video: 'Видео', leads: 'Заявки', more: 'Ещё', telegram: 'Telegram', prices: 'Тарифы и цены', log: 'Журнал' };
  let firstRun = true;
  const route = () => {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    let name = parts[0] || 'today'; if (!TITLES[name]) name = 'today';
    if (name === 'client' && !drawClient(parts[1])) return;
    ({ today: drawToday, clients: drawClients, video: drawVideo, leads: drawLeads, telegram: drawTg, prices: drawPrices, log: drawLog }[name] || (() => {}))();
    updateDot(); $('[data-menu-tg]').textContent = tg.on ? 'подключено ' + tg.user : 'не подключено';
    views.forEach(v => { v.hidden = v.dataset.view !== name; });
    $$('[data-nav]').forEach(a => { if (a.dataset.nav === NAV[name]) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = TITLES[name] + ' — админка Ники';
    window.scrollTo(0, 0);
    if (!firstRun) { const h = $('[data-view="' + name + '"] h1'); if (h) h.focus({ preventScroll: true }); }
    firstRun = false;
  };
  window.addEventListener('hashchange', route);
  route();
})();
