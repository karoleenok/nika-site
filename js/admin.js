/* Админка Ники. Экраны по hash: #/ #/clients #/client/ID #/content #/content/materials
   #/video/ID|new #/material/ID|new #/leads #/more #/prices #/log.
   ДЕМО: клиенты, заявки и цены живут в памяти и сбрасываются при обновлении страницы.
   Контент (группы, видео, материалы) пишется в localStorage и сразу виден в кабинете клиента.
   Всё из данных вставляется через textContent. */
(() => {
  'use strict';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const KEY = 'nika_admin_session', CONTENT = 'nika_demo_content';
  const rd = k => { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (_) { return null; } };
  const wr = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  if (!window.NikaSession || !window.NikaSession.active(KEY)) { location.replace('login.html'); return; }   // ДЕМО: настоящая сессия — HttpOnly-кука + 2FA
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
  const first = name => name.split(' ')[0];
  const num = v => Number(String(v || '').replace(/\D/g, '')) || 0;

  /* ---------- Контент: общий с кабинетом клиента ---------- */
  const raw = L.all ? JSON.parse(JSON.stringify(L.all)) : {
    groups: L.groups.map(g => ({ ...g, on: true })),
    videos: L.videos.map(v => ({ ...v, on: true })),
    extras: L.extras.map((x, i) => ({ ...x, on: true, price: num(x.price), old: i === 0 ? 1699 : 1699, text: '', gift: i === 0 }))
  };
  const persist = () => wr(CONTENT, JSON.stringify(raw));
  const vById = id => raw.videos.find(v => v.id === id);
  const gById = id => raw.groups.find(g => g.id === id);
  const gName = id => (gById(id) || {}).name || '';
  const inGroup = gid => raw.videos.filter(v => v.group === gid);
  /* Порядок в группе = порядок в общем массиве. Вставка/перестановка меняют только свои места. */
  const setGroupOrder = (gid, ids) => {
    const slots = []; raw.videos.forEach((v, i) => { if (v.group === gid) slots.push(i); });
    const items = ids.map(vById); slots.forEach((i, k) => { raw.videos[i] = items[k]; });
  };
  const placeVideo = (v, gid, pos) => {
    const i = raw.videos.indexOf(v); if (i > -1) raw.videos.splice(i, 1);
    v.group = gid; const list = inGroup(gid);
    if (!list.length) { raw.videos.push(v); return; }
    if (pos <= 0) raw.videos.splice(raw.videos.indexOf(list[0]), 0, v);
    else if (pos >= list.length) raw.videos.splice(raw.videos.indexOf(list[list.length - 1]) + 1, 0, v);
    else raw.videos.splice(raw.videos.indexOf(list[pos]), 0, v);
  };

  /* ---------- Клиенты (демо) ---------- */
  /* Доступ считается неделями, а не календарными месяцами: 1 месяц = 4 недели, 2 = 8, 4 = 16. Срок = недели × 7 дней. */
  const WEEKS = { '24 часа': 0, '1 месяц': 4, '2 месяца': 8, '4 месяца': 16, 'Фигура под ключ': 8 };
  const planDays = name => (name === '24 часа' ? 1 : (WEEKS[name] || 4) * 7);
  const clients = A.clients.map((c, i) => ({
    ...c, until: addDays(today, c.days), reminded: false, closed: false, email: '', phone: '',
    watched: [0, 5, 7, 3, 9, 4, 12, 8, 6, 10, 2, 1][i] || 0, mats: {}
  }));
  clients.forEach((c, i) => raw.extras.forEach((x, k) => { c.mats[x.id] = (i + k) % 3 === 0; }));
  const log = A.log.map(x => ({ ...x }));
  const leads = A.leads.map(x => ({ ...x }));
  const tariffs = A.tariffs.map(t => ({ ...t }));
  const left = c => Math.round((c.until - today) / 864e5);
  const stateOf = c => { const d = left(c); return d <= 0 ? 'bad' : d <= 7 ? 'warn' : 'ok'; };
  const STAT = { ok: 'активен', warn: 'заканчивается', bad: 'закончился' };
  const byId = id => clients.find(c => c.id === id);
  const addLog = (cid, text, note) => log.unshift({ cid, when: 'сейчас', who: 'Ника', text, note: note || '' });
  const sorted = () => clients.slice().sort((a, b) => left(a) - left(b));
  const statText = c => { const d = left(c); return d <= 0 ? (c.closed ? 'закрыт вручную' : 'закончился ' + (d === 0 ? 'сегодня' : dayWord(-d) + ' назад')) : 'до ' + fmt(c.until) + ' · ' + dayWord(d); };

  if (L.demo) $('[data-demo-bar]').hidden = false;
  $('[data-demo-bar]').textContent = 'Демо: клиенты, заявки и цены сбрасываются при обновлении. Контент (видео, группы, материалы) сохраняется и сразу виден в кабинете клиента.';

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
  let confirmFn = null;
  const confirmDlg = (title, text, ok, fn) => { $('[data-dc-title]').textContent = title; $('[data-dc-text]').textContent = text; $('[data-dc-ok]').textContent = ok; confirmFn = fn; openDlg('confirm'); };
  $('[data-form="confirm"]').addEventListener('submit', e => { e.preventDefault(); dlg('confirm').close(); const f = confirmFn; confirmFn = null; if (f) f(); });

  /* ---------- Связь с клиентом (в демо телефона нет, показываем текст) ---------- */
  const contact = (c, text) => {
    if (c.phone) { window.open('https://wa.me/' + c.phone.replace(/\D/g, '') + '?text=' + encodeURIComponent(text), '_blank', 'noopener'); return; }
    toast('Демо: откроется WhatsApp с текстом «' + text + '»');
  };
  const remindText = c => 'Привет, ' + first(c.name) + '! ' + (left(c) <= 0 ? 'Твой доступ к тренировкам закончился ' + fmt(c.until) + '.' : 'Твой доступ к тренировкам заканчивается ' + fmt(c.until) + '.') + ' Продлить можно здесь: ' + A.siteUrl + '#services. Если нужна помощь, напиши.';
  const remind = c => { contact(c, remindText(c)); c.reminded = true; addLog(c.id, 'Написала ' + c.name + ' о продлении'); };

  /* ---------- Перетаскивание (указатель и клавиатура) ---------- */
  const sortable = (ul, onDone) => {
    const ids = () => $$(':scope > li', ul).map(li => li.dataset.id);
    ul.addEventListener('pointerdown', e => {
      const h = e.target.closest('[data-grip]'); if (!h || (e.button && e.button !== 0)) return;
      const li = h.closest('li'); e.preventDefault(); h.setPointerCapture(e.pointerId);
      const r0 = li.getBoundingClientRect(), grab = e.clientY - r0.top; let cur = 0;
      li.classList.add('is-drag');
      const place = y => { const r = li.getBoundingClientRect(), lay = r.top - cur; cur = (y - grab) - lay; li.style.transform = 'translateY(' + cur + 'px)'; };
      const move = ev => {
        place(ev.clientY);
        const mid = li.getBoundingClientRect(); const m = mid.top + mid.height / 2;
        const sibs = $$(':scope > li', ul).filter(x => x !== li);
        const next = sibs.find(s => { const r = s.getBoundingClientRect(); return m < r.top + r.height / 2; });
        if ((next || null) !== li.nextElementSibling) { ul.insertBefore(li, next || null); place(ev.clientY); }
        if (ev.clientY < 90) window.scrollBy(0, -14); else if (ev.clientY > innerHeight - 130) window.scrollBy(0, 14);
      };
      const end = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', end); h.removeEventListener('pointercancel', end); li.classList.remove('is-drag'); li.style.transform = ''; onDone(ids()); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    });
    ul.addEventListener('keydown', e => {
      const h = e.target.closest('[data-grip]'); if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault(); const li = h.closest('li'), t = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling; if (!t) return;
      if (e.key === 'ArrowUp') ul.insertBefore(li, t); else ul.insertBefore(t, li);
      h.focus(); const n = ids(); onDone(n); toast('Номер ' + (n.indexOf(li.dataset.id) + 1) + ' из ' + n.length);
    });
  };

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
    k.appendChild(kpiLink('#/clients', act, 'с доступом', '', 'all'));
    k.appendChild(kpiLink('#/clients', warn, 'скоро закончится', warn ? 'warn' : '', 'warn'));
    k.appendChild(kpiLink('#/clients', bad, 'закончился', bad ? 'bad' : '', 'bad'));
    k.appendChild(kpiLink('#/leads', nl, nl === 1 ? 'новая заявка' : 'новых заявок', '', null));
    const todo = clients.filter(c => stateOf(c) !== 'ok').sort((a, b) => left(a) - left(b));
    const box = $('[data-todo]'); box.textContent = '';
    todo.forEach(c => {
      const st = stateOf(c), li = el('li', 'row row--todo');
      li.appendChild(el('span', 'ava ava--' + st, c.name[0]));
      const b = el('a', 'row__b'); b.href = '#/client/' + c.id;
      b.appendChild(el('span', 'row__n', c.name)); b.appendChild(el('span', 'row__s', c.plan + ' · ' + statText(c)));
      li.appendChild(b);
      const act = el('div', 'row__act');
      const d = el('span', c.reminded ? 'done' : ''); if (c.reminded) { d.appendChild(icon('i-check')); d.appendChild(document.createTextNode('написала')); } act.appendChild(d);
      const bt = el('button', 'btn ' + (c.reminded ? 'btn--line-dark' : 'btn--red'), c.reminded ? 'написать ещё раз' : 'написать в WhatsApp'); bt.type = 'button';
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
      const st = stateOf(c), li = el('li'); const a = el('a', 'row'); a.href = '#/client/' + c.id; const d = left(c);
      a.appendChild(el('span', 'ava ava--' + st, c.name[0]));
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
  const planSel = $('[data-c-plan-sel]'); tariffs.filter(t => t.access !== false).forEach(t => { const o = el('option', '', t.name); o.value = t.name; planSel.appendChild(o); });
  const histItem = (x, who) => { const li = el('li'); li.appendChild(el('span', '', x.text)); if (x.note) li.appendChild(el('span', 'hist__n', 'Заметка: ' + x.note)); li.appendChild(el('span', 'hist__w', x.when + (who ? ' · ' + x.who : ''))); return li; };
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
    $('[data-c-remind]').textContent = c.reminded ? 'написать ещё раз о продлении' : 'напомнить о продлении';
    $('[data-c-remind]').hidden = st === 'ok';
    $('[data-c-note]').value = c.note || '';
    /* Тренировки: сколько видео смотрит клиент */
    const total = raw.videos.filter(v => v.on !== false).length, w = Math.min(c.watched, total);
    $('[data-c-prog-t]').textContent = 'Просмотрено ' + w + ' из ' + total;
    const pb = $('[data-c-prog]'); pb.setAttribute('aria-label', 'Просмотрено ' + w + ' из ' + total); pb.style.setProperty('--p', total ? Math.round(w / total * 100) : 0);
    /* Материалы клиента */
    const ml = $('[data-c-mats]'); ml.textContent = '';
    raw.extras.forEach(x => {
      const li = el('li'); const l = el('label', 'sw-row'); const t = el('span', 'sw-row__t'); t.appendChild(el('b', '', x.title)); t.appendChild(el('small', '', x.kind + (c.mats[x.id] ? ' · открыт' : ' · закрыт')));
      const i = el('input', 'sw'); i.type = 'checkbox'; i.setAttribute('role', 'switch'); i.checked = !!c.mats[x.id];
      i.addEventListener('change', () => { c.mats[x.id] = i.checked; addLog(c.id, (i.checked ? 'Открыла' : 'Закрыла') + ' материал «' + x.title + '» для ' + c.name); drawClient(c.id); toast(i.checked ? 'Материал открыт клиенту' : 'Материал закрыт'); });
      l.appendChild(t); l.appendChild(i); li.appendChild(l); ml.appendChild(li);
    });
    if (!raw.extras.length) ml.appendChild(el('li', 'empty-line', 'Материалов пока нет. Добавь их в разделе «Контент».'));
    /* Данные, оплаты, история */
    const f = $('[data-c-form]'); f.elements.name.value = c.name; f.elements.email.value = c.email; f.elements.phone.value = c.phone; planSel.value = c.plan; $('[data-c-err]').textContent = '';
    const price = (tariffs.find(t => t.name === c.plan) || {}).price || 0, pay = $('[data-c-pay]'); pay.textContent = '';
    const pli = el('li'); pli.appendChild(el('span', '', 'Тариф «' + c.plan + '»')); pli.appendChild(el('span', 'pay__s', price.toLocaleString('ru-RU') + ' ₽')); pli.appendChild(el('span', 'pay__d', fmt(addDays(c.until, -planDays(c.plan))))); pay.appendChild(pli);
    const h = $('[data-c-hist]'); h.textContent = ''; const mine = log.filter(x => x.cid === c.id);
    if (!mine.length) h.appendChild(el('li', 'hist__e', 'Пока ничего не менялось.'));
    mine.forEach(x => h.appendChild(histItem(x, false)));
    return true;
  };
  $('[data-c-note]').addEventListener('change', e => { if (cur) { cur.note = e.target.value.trim(); toast('Заметка сохранена'); } });
  $('[data-c-remind]').addEventListener('click', () => { if (cur) { remind(cur); drawClient(cur.id); } });
  $('[data-c-wa]').addEventListener('click', () => { if (cur) contact(cur, 'Привет, ' + first(cur.name) + '!'); });
  $('[data-c-form]').addEventListener('submit', e => {
    e.preventDefault(); const f = e.currentTarget, nm = f.elements.name.value.trim(), em = f.elements.email.value.trim();
    if (!nm) { $('[data-c-err]').textContent = 'Напиши имя.'; f.elements.name.focus(); return; }
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { $('[data-c-err]').textContent = 'Проверь почту: похоже, опечатка.'; f.elements.email.focus(); return; }
    const planChanged = planSel.value !== cur.plan;
    cur.name = nm; cur.email = em; cur.phone = f.elements.phone.value.trim(); cur.plan = planSel.value;
    addLog(cur.id, 'Изменила данные клиента ' + cur.name + (planChanged ? ', тариф «' + cur.plan + '»' : '')); drawClient(cur.id); toast('Данные сохранены');
  });

  /* Продлить / открыть */
  const OPTS = [['+1 неделя', 1], ['+2 недели', 2], ['+4 недели', 4], ['+8 недель', 8], ['+16 недель', 16]];   // [подпись, недель]
  const fx = $('[data-form="extend"]'), optBox = $('[data-dx-opts]'), newLine = $('[data-dx-new]');
  const base = c => (c.until > today ? c.until : today);
  const pick = () => { const r = $('input:checked', optBox); return OPTS[Number(r ? r.value : 2)]; };
  const newDate = () => addDays(base(cur), pick()[1] * 7);
  const drawNew = () => { newLine.textContent = 'Доступ будет открыт до ' + fmt(newDate()); };
  OPTS.forEach((o, i) => {
    const l = el('label', 'pill'); const r = el('input'); r.type = 'radio'; r.name = 'span'; r.value = String(i); if (i === 2) r.checked = true;
    r.addEventListener('change', drawNew); l.appendChild(r); l.appendChild(el('span', '', o[0])); optBox.appendChild(l);
  });
  $('[data-c-extend]').addEventListener('click', () => {
    if (!cur) return; const bad = stateOf(cur) === 'bad';
    $('[data-dx-title]').textContent = bad ? 'Открыть доступ' : 'Продлить доступ';
    $('[data-dx-ok]').textContent = bad ? 'открыть' : 'продлить';
    $('[data-dx-who]').textContent = cur.name + ', тариф «' + cur.plan + '»' + (WEEKS[cur.plan] ? ' (' + WEEKS[cur.plan] + ' ' + plural(WEEKS[cur.plan], 'неделя', 'недели', 'недель') + ')' : '');
    $('[data-dx-note]').value = ''; $$('input', optBox)[2].checked = true; drawNew(); openDlg('extend');
  });
  fx.addEventListener('submit', e => {
    e.preventDefault(); const c = cur, prev = { until: c.until, closed: c.closed }, nd = newDate(), note = $('[data-dx-note]').value.trim();
    addLog(c.id, (prev.until > today ? 'Продлила' : 'Открыла') + ' доступ ' + c.name + ' до ' + fmt(nd), note);
    c.until = nd; c.closed = false; dlg('extend').close(); drawClient(c.id);
    toast('Доступ до ' + fmt(nd), 'отменить', () => { c.until = prev.until; c.closed = prev.closed; log.shift(); if (cur === c && location.hash.startsWith('#/client/')) drawClient(c.id); toast('Отменено'); });
  });
  $('[data-c-close]').addEventListener('click', () => {
    const c = cur; if (!c) return;
    confirmDlg('Закрыть доступ?', c.name + ' перестанет открывать видео. Данные и история останутся, открыть доступ можно в любой момент.', 'закрыть', () => {
      const prev = { until: c.until, closed: c.closed }; c.until = addDays(today, -1); c.closed = true; addLog(c.id, 'Закрыла доступ ' + c.name); drawClient(c.id);
      toast('Доступ закрыт', 'отменить', () => { c.until = prev.until; c.closed = prev.closed; log.shift(); if (cur === c && location.hash.startsWith('#/client/')) drawClient(c.id); toast('Отменено'); });
    });
  });

  /* ---------- Контент: тренировки (группы и видео) ---------- */
  const open = new Set();   // свёрнутые группы
  const vMeta = v => (v.on === false ? 'скрыто от клиентов' : 'видно клиентам');
  const drawVideos = () => {
    const box = $('[data-groups]'); box.textContent = '';
    const total = raw.videos.length, hid = raw.videos.filter(v => v.on === false).length;
    $('[data-v-sum]').textContent = total + ' ' + plural(total, 'видео', 'видео', 'видео') + ' в ' + raw.groups.length + ' ' + plural(raw.groups.length, 'группе', 'группах', 'группах') + (hid ? ', скрыто ' + hid : '');
    raw.groups.forEach(g => {
      const list = inGroup(g.id), collapsed = open.has(g.id);
      const card = el('section', 'grp' + (g.on === false ? ' is-off' : ''));
      const h = el('div', 'grp__h');
      const t = el('button', 'grp__t'); t.type = 'button'; t.setAttribute('aria-expanded', String(!collapsed));
      t.appendChild(el('span', 'grp__n', g.name)); t.appendChild(el('span', 'grp__c', list.length + (g.on === false ? ' · скрыта' : '')));
      t.appendChild(icon('i-down', 'grp__chev'));
      const body = el('div', 'grp__b'); body.hidden = collapsed;
      t.addEventListener('click', () => { const c = t.getAttribute('aria-expanded') === 'true'; t.setAttribute('aria-expanded', String(!c)); body.hidden = c; if (c) open.add(g.id); else open.delete(g.id); });
      const e = el('button', 'grp__e', 'изменить'); e.type = 'button'; e.setAttribute('aria-label', 'Изменить группу ' + g.name); e.addEventListener('click', () => openGroup(g.id));
      h.appendChild(t); h.appendChild(e); card.appendChild(h);
      if (!list.length) body.appendChild(el('p', 'grp__empty', 'В этой группе пока нет видео.'));
      const ul = el('ul', 'vlist');
      list.forEach(v => {
        const li = el('li', 'vi' + (v.on === false ? ' is-off' : '')); li.dataset.id = v.id;
        const gr = el('button', 'grip'); gr.type = 'button'; gr.dataset.grip = ''; gr.appendChild(icon('i-grip'));
        gr.setAttribute('aria-label', 'Переместить «' + v.title + '». Стрелки вверх и вниз меняют место.');
        li.appendChild(gr); li.appendChild(el('span', 'vi__no'));
        const a = el('a', 'vi__go'); a.href = '#/video/' + v.id;
        const b = el('span'); b.appendChild(el('span', 'vi__n', v.title)); b.appendChild(el('span', 'vi__s', vMeta(v))); a.appendChild(b);
        if (v.on === false) a.appendChild(el('span', 'stat stat--off', 'скрыто'));
        li.appendChild(a); ul.appendChild(li);
      });
      sortable(ul, ids => { setGroupOrder(g.id, ids); persist(); drawNumbersOnly(); });
      if (list.length) body.appendChild(ul);
      const add = el('a', 'grp__add'); add.href = '#/video/new?g=' + g.id; add.appendChild(icon('i-plus')); add.appendChild(document.createTextNode('добавить видео в «' + g.name + '»'));
      body.appendChild(add); card.appendChild(body); box.appendChild(card);
    });
    if (!raw.groups.length) box.appendChild(el('p', 'empty-line', 'Групп пока нет. Нажми «+ группа», чтобы начать.'));
  };
  const drawNumbersOnly = () => { /* номера считает CSS-счётчик, ничего перерисовывать не нужно */ };

  /* Группа: добавить, переименовать, спрятать, переместить, удалить */
  let gEdit = null;
  const openGroup = id => {
    gEdit = id ? gById(id) : null;
    $('[data-dg-title]').textContent = gEdit ? 'Изменить группу' : 'Новая группа';
    $('[data-dg-name]').value = gEdit ? gEdit.name : ''; $('[data-dg-err]').textContent = '';
    $('[data-dg-on]').checked = gEdit ? gEdit.on !== false : true;
    $('[data-dg-mv]').hidden = !gEdit; $('[data-dg-del]').hidden = !gEdit;
    openDlg('group');
  };
  $('[data-g-add]').addEventListener('click', () => openGroup(null));
  $('[data-form="group"]').addEventListener('submit', e => {
    e.preventDefault(); const n = $('[data-dg-name]').value.trim();
    if (!n) { $('[data-dg-err]').textContent = 'Напиши название группы.'; $('[data-dg-name]').focus(); return; }
    if (raw.groups.some(g => g !== gEdit && g.name.toLowerCase() === n.toLowerCase())) { $('[data-dg-err]').textContent = 'Такая группа уже есть.'; return; }
    const on = $('[data-dg-on]').checked;
    if (gEdit) { gEdit.name = n; gEdit.on = on; } else raw.groups.push({ id: 'g' + Date.now(), name: n, on });
    persist(); dlg('group').close(); drawVideos(); toast(gEdit ? 'Группа сохранена' : 'Группа добавлена');
  });
  const moveGroup = d => { const i = raw.groups.indexOf(gEdit), j = i + d; if (!gEdit || j < 0 || j >= raw.groups.length) { toast(d < 0 ? 'Это уже первая группа' : 'Это уже последняя группа'); return; } raw.groups.splice(j, 0, raw.groups.splice(i, 1)[0]); persist(); drawVideos(); toast('Группа теперь ' + (j + 1) + '-я из ' + raw.groups.length); };
  $('[data-dg-up]').addEventListener('click', () => moveGroup(-1));
  $('[data-dg-down]').addEventListener('click', () => moveGroup(1));
  $('[data-dg-del]').addEventListener('click', () => {
    const g = gEdit; if (!g) return; const n = inGroup(g.id).length; dlg('group').close();
    if (n) { toast('В группе ещё ' + n + ' ' + plural(n, 'видео', 'видео', 'видео') + '. Сначала перенеси их в другую группу.'); return; }
    const i = raw.groups.indexOf(g); raw.groups.splice(i, 1); persist(); drawVideos();
    toast('Группа удалена', 'вернуть', () => { raw.groups.splice(i, 0, g); persist(); drawVideos(); });
  });

  /* ---------- Редактор видео ---------- */
  let ve = null;   // { v, isNew, tags, file }
  const vf = $('[data-ve]'), vgSel = $('[data-ve-group]'), vpSel = $('[data-ve-pos]'), tagsUl = $('[data-ve-tags]');
  const drawTags = () => {
    tagsUl.textContent = '';
    ve.tags.forEach((t, i) => { const li = el('li', 'tag'); li.appendChild(el('span', '', t)); const b = el('button'); b.type = 'button'; b.setAttribute('aria-label', 'Убрать: ' + t); b.appendChild(icon('i-x')); b.addEventListener('click', () => { ve.tags.splice(i, 1); drawTags(); }); li.appendChild(b); tagsUl.appendChild(li); });
  };
  const addTag = () => { const i = $('[data-ve-tag-in]'), t = i.value.trim(); if (t && !ve.tags.some(x => x.toLowerCase() === t.toLowerCase())) { ve.tags.push(t); drawTags(); } i.value = ''; i.focus(); };
  $('[data-ve-tag-add]').addEventListener('click', addTag);
  $('[data-ve-tag-in]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
  const drawPos = () => {
    const gid = vgSel.value, n = inGroup(gid).filter(x => x !== ve.v).length + 1, keep = Number(vpSel.value) || 0;
    vpSel.textContent = ''; for (let i = 1; i <= n; i++) { const o = el('option', '', i + (i === 1 ? ' (первым)' : i === n ? ' (последним)' : '')); o.value = String(i); vpSel.appendChild(o); }
    vpSel.value = String(Math.min(keep || n, n));
  };
  vgSel.addEventListener('change', () => { vpSel.value = ''; drawPos(); });
  const setFile = (box, tEl, name, def) => { box.classList.toggle('is-set', !!name); tEl.textContent = name ? 'Выбран файл: ' + name : def; };
  $('[data-ve-file]').addEventListener('change', e => { const f = e.target.files[0]; ve.file = f ? f.name : ve.file; setFile($('[data-ve-drop]'), $('[data-ve-file-t]'), ve.file, 'Выбрать видеофайл'); });
  $('[data-ve-on]').addEventListener('change', e => { $('[data-ve-vis-s]').textContent = e.target.checked ? 'Клиенты видят это видео в своём кабинете.' : 'Пока выключено, клиенты это видео не видят.'; });
  const drawVideoEd = (id, gid) => {
    const isNew = id === 'new', v = isNew ? null : vById(id);
    if (!isNew && !v) { location.replace('#/content'); return false; }
    if (!raw.groups.length) { toast('Сначала добавь группу'); location.replace('#/content'); return false; }
    ve = { v, isNew, tags: v ? v.gear.slice() : [], file: v ? v.file || null : null };
    $('[data-ve-h]').textContent = isNew ? 'Новое видео' : v.title;
    vgSel.textContent = ''; raw.groups.forEach(g => { const o = el('option', '', g.name); o.value = g.id; vgSel.appendChild(o); });
    const f = vf.elements; f.title.value = v ? v.title : ''; f.text.value = v ? v.text : '';
    vgSel.value = v ? v.group : (gById(gid) ? gid : raw.groups[0].id);
    vpSel.value = v ? String(inGroup(v.group).indexOf(v) + 1) : ''; drawPos();
    f.on.checked = v ? v.on !== false : false; $('[data-ve-vis-s]').textContent = f.on.checked ? 'Клиенты видят это видео в своём кабинете.' : 'Пока выключено, клиенты это видео не видят.';
    setFile($('[data-ve-drop]'), $('[data-ve-file-t]'), ve.file, 'Выбрать видеофайл'); $('[data-ve-err]').textContent = ''; drawTags();
    $('[data-ve-del]').hidden = isNew; $('[data-ve-preview]').hidden = isNew;
    return true;
  };
  vf.addEventListener('submit', e => {
    e.preventDefault(); const f = vf.elements, t = f.title.value.trim();
    if (!t) { $('[data-ve-err]').textContent = 'Напиши название, чтобы клиенты нашли видео.'; f.title.focus(); return; }
    const v = ve.v || { id: 'v' + Date.now() };
    Object.assign(v, { title: t, text: f.text.value.trim(), gear: ve.tags.slice(), on: f.on.checked, file: ve.file });
    placeVideo(v, vgSel.value, Number(vpSel.value) - 1); persist();
    const was = ve.isNew; toast(was ? 'Видео добавлено' + (v.on ? '' : ' (пока скрыто)') : 'Сохранено'); location.hash = '#/content';
  });
  $('[data-ve-preview]').addEventListener('click', () => { if (!ve.v) return; wr('nika_lk_session', '1'); window.open('../lk/index.html#/video/' + ve.v.id, '_blank', 'noopener'); });
  $('[data-ve-del]').addEventListener('click', () => {
    const v = ve.v; if (!v) return;
    confirmDlg('Удалить видео?', '«' + v.title + '» пропадёт из кабинета всех клиентов. Если не уверена, лучше выключи «Показывать клиентам».', 'удалить', () => {
      const i = raw.videos.indexOf(v); raw.videos.splice(i, 1); persist(); location.hash = '#/content';
      toast('Видео удалено', 'вернуть', () => { raw.videos.splice(i, 0, v); persist(); if (location.hash === '#/content') drawVideos(); });
    });
  });

  /* ---------- Контент: материалы ---------- */
  const drawMaterials = () => {
    const ul = $('[data-mlist]'); ul.textContent = '';
    $('[data-m-sum]').textContent = raw.extras.length + ' ' + plural(raw.extras.length, 'материал', 'материала', 'материалов');
    raw.extras.forEach(x => {
      const li = el('li'); const a = el('a', 'mrow'); a.href = '#/material/' + x.id;
      const img = el('img'); img.alt = ''; img.src = x.cover || '../favicon.png'; img.width = 64; img.height = 80; a.appendChild(img);
      const b = el('span', 'mrow__b'); b.appendChild(el('span', 'mrow__k', x.kind)); b.appendChild(el('span', 'mrow__t', x.title)); b.appendChild(el('span', 'mrow__p', (x.price || 0).toLocaleString('ru-RU') + ' ₽' + (x.gift ? ' · дарим' : ''))); a.appendChild(b);
      if (x.on === false) a.appendChild(el('span', 'stat stat--off', 'скрыт'));
      li.appendChild(a); ul.appendChild(li);
    });
    if (!raw.extras.length) ul.appendChild(el('li', 'empty-line', 'Материалов пока нет. Нажми «+ материал».'));
  };
  let me = null; const mf = $('[data-me]');
  const drawMaterialEd = id => {
    const isNew = id === 'new', x = isNew ? null : raw.extras.find(e => e.id === id);
    if (!isNew && !x) { location.replace('#/content/materials'); return false; }
    me = { x, isNew, cover: x ? x.cover || '' : '', file: x ? x.file || null : null };
    $('[data-me-h]').textContent = isNew ? 'Новый материал' : x.title;
    const f = mf.elements; f.kind.value = x ? x.kind : 'гайд'; f.title.value = x ? x.title : ''; f.text.value = x && x.text ? x.text : ''; f.price.value = x ? x.price || '' : ''; f.old.value = x && x.old ? x.old : '';
    f.on.checked = x ? x.on !== false : false; f.gift.checked = x ? !!x.gift : false; $('[data-me-err]').textContent = '';
    const img = $('[data-me-cover]'); img.hidden = !me.cover; if (me.cover) img.src = me.cover;
    setFile($('[data-me-cover-in]').parentElement, $('[data-me-cover-t]'), null, me.cover ? 'Заменить картинку' : 'Выбрать картинку');
    setFile($('[data-me-file]').parentElement, $('[data-me-file-t]'), me.file, 'Выбрать файл (PDF или видео)');
    $('[data-me-del]').hidden = isNew; return true;
  };
  $('[data-me-cover-in]').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { me.cover = String(r.result); const img = $('[data-me-cover]'); img.src = me.cover; img.hidden = false; setFile(e.target.parentElement, $('[data-me-cover-t]'), f.name, ''); }; r.readAsDataURL(f); });
  $('[data-me-file]').addEventListener('change', e => { const f = e.target.files[0]; if (f) { me.file = f.name; setFile(e.target.parentElement, $('[data-me-file-t]'), me.file, ''); } });
  mf.addEventListener('submit', e => {
    e.preventDefault(); const f = mf.elements, t = f.title.value.trim(), p = num(f.price.value), o = num(f.old.value);
    if (!t) { $('[data-me-err]').textContent = 'Напиши название материала.'; f.title.focus(); return; }
    if (o && o <= p) { $('[data-me-err]').textContent = 'Старая цена должна быть выше новой, иначе скидки нет.'; f.old.focus(); return; }
    const x = me.x || { id: 'm' + Date.now(), href: '../index.html#shop', owned: false };
    Object.assign(x, { kind: f.kind.value, title: t, text: f.text.value.trim(), price: p, old: o, on: f.on.checked, gift: f.gift.checked, cover: me.cover, file: me.file });
    if (me.isNew) raw.extras.push(x);
    persist(); toast(me.isNew ? 'Материал добавлен' + (x.on ? '' : ' (пока скрыт)') : 'Сохранено'); location.hash = '#/content/materials';
  });
  $('[data-me-del]').addEventListener('click', () => {
    const x = me.x; if (!x) return;
    confirmDlg('Удалить материал?', '«' + x.title + '» пропадёт из кабинета и магазина. Если не уверена, лучше выключи «Показывать клиентам».', 'удалить', () => {
      const i = raw.extras.indexOf(x); raw.extras.splice(i, 1); persist(); location.hash = '#/content/materials';
      toast('Материал удалён', 'вернуть', () => { raw.extras.splice(i, 0, x); persist(); if (location.hash.startsWith('#/content/materials')) drawMaterials(); });
    });
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

  /* ---------- Цены ---------- */
  const drawPrices = () => {
    const f = $('[data-prices]'); f.textContent = '';
    tariffs.forEach(t => {
      const box = el('div', 'tcard'); if (t.group) box.appendChild(el('p', 'tcard__g', t.group)); box.appendChild(el('p', 'tcard__n', t.name));
      const g = el('div', 'tcard__f');
      const fld = (lab, val, name) => { const l = el('label', 'field'); l.appendChild(el('span', 'field__label', lab)); const i = el('input', 'field__input'); i.type = 'text'; i.inputMode = 'numeric'; i.value = val || ''; i.name = name; i.autocomplete = 'off'; l.appendChild(i); return [l, i]; };
      const [l1, i1] = fld('Цена, ₽', t.price, 'price'), [l2, i2] = fld('Старая цена, ₽', t.old, 'old');
      g.appendChild(l1); g.appendChild(l2); box.appendChild(g);
      const err = el('p', 'field__err'); err.setAttribute('role', 'alert'); box.appendChild(err);
      const act = el('div', 'tcard__act'); const sv = el('button', 'btn btn--red', 'сохранить'); sv.type = 'submit'; act.appendChild(sv); box.appendChild(act);
      box.addEventListener('submit', e => e.preventDefault());
      sv.addEventListener('click', e => {
        e.preventDefault(); const p = num(i1.value), o = i2.value.trim() ? num(i2.value) : 0;
        i1.removeAttribute('aria-invalid'); i2.removeAttribute('aria-invalid'); err.textContent = '';
        if (!p) { err.textContent = 'Укажи цену цифрами.'; i1.setAttribute('aria-invalid', 'true'); i1.focus(); return; }
        if (o && o <= p) { err.textContent = 'Старая цена должна быть выше новой, иначе скидки нет.'; i2.setAttribute('aria-invalid', 'true'); i2.focus(); return; }
        t.price = p; t.old = o; i1.value = p; i2.value = o || ''; addLog(null, 'Изменила цену «' + t.name + '»: ' + p.toLocaleString('ru-RU') + ' ₽'); toast('Цена «' + t.name + '» сохранена');
      });
      f.appendChild(box);
    });
  };

  /* ---------- Журнал, выход, сброс демо ---------- */
  const drawLog = () => { const ul = $('[data-log]'); ul.textContent = ''; log.forEach(x => ul.appendChild(histItem(x, true))); };
  $$('[data-logout]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); window.NikaSession.end(KEY); location.replace('login.html'); }));
  $('[data-reset-demo]').addEventListener('click', () => confirmDlg('Сбросить демо?', 'Контент вернётся к исходному. Настоящих данных здесь нет.', 'сбросить', () => { try { localStorage.removeItem(CONTENT); localStorage.removeItem(TGK); } catch (_) {} location.hash = '#/'; location.reload(); }));

  /* ---------- Роутер ---------- */
  const views = $$('[data-view]');
  const NAV = { today: 'today', clients: 'clients', client: 'clients', content: 'content', video: 'content', material: 'content', leads: 'leads', more: 'more', prices: 'more', log: 'more' };
  const TITLES = { today: 'Сегодня', clients: 'Клиенты', client: 'Клиент', content: 'Контент', video: 'Видео', material: 'Материал', leads: 'Заявки', more: 'Ещё', prices: 'Тарифы и цены', log: 'Журнал' };
  let firstRun = true;
  const route = () => {
    const full = location.hash.replace(/^#\/?/, ''), qi = full.indexOf('?'), path = qi > -1 ? full.slice(0, qi) : full, qs = new URLSearchParams(qi > -1 ? full.slice(qi + 1) : '');
    const parts = path.split('/');
    let name = parts[0] || 'today'; if (!TITLES[name]) name = 'today';
    if (name === 'client' && !drawClient(parts[1])) return;
    if (name === 'video' && (!parts[1] || !drawVideoEd(parts[1], qs.get('g')))) { if (!parts[1]) location.replace('#/content'); return; }
    if (name === 'material' && (!parts[1] || !drawMaterialEd(parts[1]))) { if (!parts[1]) location.replace('#/content/materials'); return; }
    if (name === 'content') {
      const tab = parts[1] === 'materials' ? 'materials' : 'videos';
      $$('[data-seg]').forEach(a => a.setAttribute('aria-selected', String(a.dataset.seg === tab)));
      $$('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== tab; });
      if (tab === 'videos') drawVideos(); else drawMaterials();
    }
    ({ today: drawToday, clients: drawClients, leads: drawLeads, prices: drawPrices, log: drawLog }[name] || (() => {}))();
    updateDot();
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
