/* Админка Ники. Экраны по hash: #/ #/clients #/client/ID #/content #/content/materials
   #/video/ID|new #/material/ID|new #/leads #/more #/prices #/log.
   Клиенты, доступы, цены и журнал приходят с сервера (js/api.js), роль проверяет сервер.
   Группы и видео тоже с сервера (фаза 3), файлы грузит js/uploader.js прямо в хранилище.
   ДЕМО пока: заявки и материалы (фаза 5): они в localStorage и видны в кабинете клиента.
   Всё из данных вставляется через textContent. */
(() => {
  'use strict';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const CONTENT = 'nika_demo_content';
  const rd = k => { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (_) { return null; } };
  const wr = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  /* Вход и роль проверяет сервер (HttpOnly-кука). Без сессии — на экран входа. */
  window.NikaApi.gate('admin').then(who => { if (who) start(who); });
  async function start(who) {
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

  /* ---------- Контент ---------- */
  /* Группы и видео живут на сервере (loadContent). Материалы пока демо: localStorage, общий с кабинетом клиента. */
  const raw = {
    groups: [], videos: [],
    extras: L.all && L.all.extras ? JSON.parse(JSON.stringify(L.all.extras)) : L.extras.map((x, i) => ({ ...x, on: true, price: num(x.price), old: 1699, text: '', gift: i === 0 }))
  };
  const persist = () => wr(CONTENT, JSON.stringify({ extras: raw.extras }));
  const vById = id => raw.videos.find(v => v.id === id);
  const gById = id => raw.groups.find(g => g.id === id);
  const inGroup = gid => raw.videos.filter(v => v.group === gid);

  /* ---------- Данные с сервера ---------- */
  /* Клиенты, доступы, цены, журнал, группы и видео живут на сервере. Заявки и материалы пока демо (фаза 5). */
  const api = window.NikaApi;
  const ROLE = who.role;
  const canMoney = ROLE === 'owner' || ROLE === 'tech';
  $$('[data-role]').forEach(n => { n.hidden = !n.dataset.role.split(' ').includes(ROLE); });
  { const m = $('.menu'); if (m && $$('li', m).every(li => li.hidden)) m.remove(); }   // у Дианы в «Ещё» нет пунктов меню: пустую рамку не показываем
  const money = rub => Number(rub).toLocaleString('ru-RU') + ' ₽';
  const when = iso => {
    const d = new Date(iso), t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    return diff === 0 ? 'сегодня, ' + t : diff === 1 ? 'вчера, ' + t : fmt(d) + (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '');
  };
  let clients = [], purchases = [], accessTariffs = [], priceList = [], logList = [];
  const leads = A.leads.map(x => ({ ...x }));
  const toClient = v => ({ ...v, plan: v.plan ? v.plan.name : '', weeks: v.plan ? v.plan.weeks : 0, until: v.endsAt ? new Date(v.endsAt) : null });
  /* ok / warn — зелёный и жёлтый; bad и none (доступа не было) — красный */
  const stateOf = c => (c.state === 'none' ? 'bad' : c.state);
  const STAT = { ok: 'активен', warn: 'заканчивается', bad: 'закончился' };
  const byId = id => clients.find(c => c.id === String(id));
  const agoText = n => (n === 0 ? 'сегодня' : dayWord(n) + ' назад');
  const statText = c => {
    if (c.state === 'none') return 'доступа пока нет';
    if (c.state === 'bad') return c.closed ? 'закрыт ' + agoText(c.daysAgo || 0) : 'закончился ' + agoText(c.daysAgo || 0);
    return 'до ' + fmt(c.until) + ' · ' + dayWord(c.daysLeft);
  };
  const shortStat = c => (c.state === 'none' ? 'нет доступа' : c.state === 'bad' ? (c.closed ? 'закрыт' : 'закончился') : dayWord(c.daysLeft));
  /* Сначала те, кому ещё не открыли доступ, потом закончившиеся (давнишние раньше), потом по близости конца */
  const rank = c => (c.state === 'none' ? -1e6 : c.state === 'bad' ? -(c.daysAgo || 0) - 1 : c.daysLeft);
  const sorted = () => clients.slice().sort((a, b) => rank(a) - rank(b));

  /* Ошибки сети и просроченный вход: понятная реакция, а не тишина */
  const fail = r => {
    if (r.status === 401) { location.replace('login.html'); return; }
    toast(r.data.error || 'Что-то пошло не так. Попробуй ещё раз.');
  };
  const loadClients = async () => { const r = await api.get('/api/admin/clients'); if (!r.ok) { fail(r); return false; } clients = r.data.clients.map(toClient); return true; };
  const loadPurchases = async () => { const r = await api.get('/api/admin/purchases'); if (r.ok) purchases = r.data.purchases; };
  const loadAccessTariffs = async () => { const r = await api.get('/api/tariffs'); if (r.ok) accessTariffs = r.data.tariffs.filter(t => t.kind === 'access'); };
  const loadPrices = async () => { if (!canMoney) return; const r = await api.get('/api/admin/tariffs'); if (r.ok) priceList = r.data.tariffs; else fail(r); };
  const loadLog = async () => { if (!canMoney) return; const r = await api.get('/api/admin/log'); if (r.ok) logList = r.data.log; else fail(r); };

  /* Текст записи журнала без «она/он»: действие в страдательной форме, кто сделал — отдельной строкой */
  const logText = x => {
    const m = x.meta || {}, e = m.endsAt ? new Date(m.endsAt) : null;
    switch (x.action) {
      case 'client.create': return 'Клиент добавлен';
      case 'client.update': return 'Изменены данные клиента';
      case 'client.note': return 'Изменена заметка о клиенте';
      case 'client.remind': return 'Отправлено напоминание о продлении';
      case 'access.open': return 'Доступ открыт' + (e ? ' до ' + fmt(e) : '');
      case 'access.extend': return 'Доступ продлён' + (e ? ' до ' + fmt(e) : '');
      case 'access.undo': return 'Отменено последнее продление';
      case 'access.close': return 'Доступ закрыт';
      case 'tariff.price': return 'Цена «' + (m.name || '') + '»: ' + money(m.from) + ' → ' + money(m.to);
      default: return 'Действие: ' + x.action;
    }
  };

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
  let confirmFn = null;
  const confirmDlg = (title, text, ok, fn) => { $('[data-dc-title]').textContent = title; $('[data-dc-text]').textContent = text; $('[data-dc-ok]').textContent = ok; confirmFn = fn; openDlg('confirm'); };
  $('[data-form="confirm"]').addEventListener('submit', e => { e.preventDefault(); dlg('confirm').close(); const f = confirmFn; confirmFn = null; if (f) f(); });

  /* ---------- Связь с клиентом ---------- */
  const waDigits = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '8' ? '7' + d.slice(1) : d; };
  const contact = (c, text) => {
    if (!waDigits(c.phone)) { toast('Телефона нет. Добавь его в «Данные клиента».'); return false; }
    window.open('https://wa.me/' + waDigits(c.phone) + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
    return true;
  };
  const remindText = c => 'Привет, ' + first(c.name) + '! ' + (c.state === 'bad' ? 'Твой доступ к тренировкам закончился ' + fmt(c.until) + '.' : 'Твой доступ к тренировкам заканчивается ' + fmt(c.until) + '.') + ' Продлить можно здесь: ' + A.siteUrl + '#services. Если нужна помощь, напиши.';
  const remind = async c => {
    if (!contact(c, remindText(c))) return;
    const r = await api.post('/api/admin/clients/' + c.id + '/remind');
    if (!r.ok) { fail(r); return; }
    c.reminded = true;
  };

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
    const act = clients.filter(c => c.state === 'ok' || c.state === 'warn').length, warn = clients.filter(c => c.state === 'warn').length, bad = clients.filter(c => c.state === 'bad').length, nl = leads.filter(l => l.isNew).length;
    const k = $('[data-kpis]'); k.textContent = '';
    k.appendChild(kpiLink('#/clients', act, 'с доступом', '', 'ok'));
    k.appendChild(kpiLink('#/clients', warn, 'скоро закончится', warn ? 'warn' : '', 'warn'));
    k.appendChild(kpiLink('#/clients', bad, 'закончился', bad ? 'bad' : '', 'bad'));
    k.appendChild(kpiLink('#/leads', nl, nl === 1 ? 'новая заявка' : 'новых заявок', '', null));
    const todo = clients.filter(c => c.state === 'warn' || c.state === 'bad').sort((a, b) => rank(a) - rank(b));
    const box = $('[data-todo]'); box.textContent = '';
    todo.forEach(c => {
      const st = stateOf(c), li = el('li', 'row row--todo');
      li.appendChild(el('span', 'ava ava--' + st, c.name[0]));
      const b = el('a', 'row__b'); b.href = '#/client/' + c.id;
      b.appendChild(el('span', 'row__n', c.name)); b.appendChild(el('span', 'row__s', (c.plan ? c.plan + ' · ' : '') + statText(c)));
      li.appendChild(b);
      const actBox = el('div', 'row__act');
      const d = el('span', c.reminded ? 'done' : ''); if (c.reminded) { d.appendChild(icon('i-check')); d.appendChild(document.createTextNode('написала')); } actBox.appendChild(d);
      const bt = el('button', 'btn ' + (c.reminded ? 'btn--line-dark' : 'btn--red'), c.reminded ? 'написать ещё раз' : 'написать в WhatsApp'); bt.type = 'button';
      bt.addEventListener('click', async () => { await remind(c); drawToday(); });
      actBox.appendChild(bt); li.appendChild(actBox); box.appendChild(li);
    });
    $('[data-todo-empty]').hidden = todo.length > 0;
    const pl = $('[data-purchases]'); pl.textContent = '';
    purchases.forEach(p => { const li = el('li'); li.appendChild(el('span', '', p.client + ' · ' + p.title)); li.appendChild(el('span', 'pay__s', money(p.sumKop / 100))); li.appendChild(el('span', 'pay__d', when(p.at))); pl.appendChild(li); });
    if (!purchases.length) pl.appendChild(el('li', 'hist__e', 'Покупок пока нет.'));
  };

  /* ---------- Клиенты ---------- */
  const cf = { f: 'all', q: '' };
  const FIL = [['all', 'Все'], ['ok', 'Активные'], ['warn', 'Заканчивается'], ['bad', 'Закончился']];
  const drawClients = () => {
    const chips = $('[data-cl-chips]'); chips.textContent = '';
    FIL.forEach(([id, name]) => { const b = el('button', 'chip', name); b.type = 'button'; b.setAttribute('aria-pressed', String(cf.f === id)); b.addEventListener('click', () => { cf.f = id; drawClients(); }); chips.appendChild(b); });
    const q = cf.q.trim().toLowerCase();
    const list = sorted().filter(c => (cf.f === 'all' || stateOf(c) === cf.f) && (!q || (c.name + ' ' + c.email).toLowerCase().includes(q)));
    const ul = $('[data-cl-list]'); ul.textContent = '';
    list.forEach(c => {
      const st = stateOf(c), li = el('li'); const a = el('a', 'row'); a.href = '#/client/' + c.id;
      a.appendChild(el('span', 'ava ava--' + st, c.name[0]));
      const b = el('span', 'row__b'); b.appendChild(el('span', 'row__n', c.name));
      b.appendChild(el('span', 'row__s', (c.plan ? c.plan + ' · ' : '') + (c.state === 'ok' || c.state === 'warn' ? 'до ' + fmt(c.until) : statText(c)))); a.appendChild(b);
      const r = el('span', 'row__r'); r.appendChild(el('span', 'stat stat--' + st, shortStat(c))); a.appendChild(r);
      li.appendChild(a); ul.appendChild(li);
    });
    $('[data-cl-count]').textContent = list.length ? list.length + ' ' + plural(list.length, 'клиент', 'клиента', 'клиентов') : '';
    const none = !clients.length;
    $('[data-cl-empty] .empty__t').textContent = none ? 'Клиентов пока нет' : 'Никого не нашла';
    $('[data-cl-empty] .empty__p').textContent = none ? 'Нажми «+ клиент», чтобы добавить первого.' : 'Попробуй другое имя или сбрось фильтр.';
    $('[data-cl-reset]').hidden = none;
    $('[data-cl-empty]').hidden = list.length > 0; ul.hidden = !list.length;
  };
  $('[data-cl-q]').addEventListener('input', e => { cf.q = e.target.value; drawClients(); });
  $('[data-cl-form]').addEventListener('submit', e => e.preventDefault());
  $('[data-cl-reset]').addEventListener('click', () => { cf.f = 'all'; cf.q = ''; $('[data-cl-q]').value = ''; drawClients(); });

  /* Новый клиент */
  const fnc = $('[data-form="newclient"]');
  $('[data-cl-add]').addEventListener('click', () => { fnc.reset(); $('[data-dn-err]').textContent = ''; openDlg('newclient'); fnc.elements.name.focus(); });
  fnc.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget, err = $('[data-dn-err]'); err.textContent = '';
    const body = { name: f.elements.name.value.trim(), email: f.elements.email.value.trim(), phone: f.elements.phone.value.trim() };
    if (!body.name) { err.textContent = 'Напиши имя.'; f.elements.name.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) { err.textContent = 'Проверь почту: похоже, опечатка.'; f.elements.email.focus(); return; }
    const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await api.post('/api/admin/clients', body); btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); err.textContent = r.data.error; return; }
    dlg('newclient').close(); await loadClients(); toast('Клиент добавлен'); location.hash = '#/client/' + r.data.id;
  });

  /* ---------- Карточка клиента ---------- */
  let cur = null;
  const histItem = (x, showWho) => { const li = el('li'); li.appendChild(el('span', '', x.text)); if (x.note) li.appendChild(el('span', 'hist__n', 'Заметка: ' + x.note)); li.appendChild(el('span', 'hist__w', x.when + (showWho && x.who ? ' · ' + x.who : ''))); return li; };
  const fillDetail = d => {
    const pay = $('[data-c-pay]'); pay.textContent = '';
    d.payments.forEach(p => { const li = el('li'); li.appendChild(el('span', '', p.title + (p.status === 'refunded' ? ' (возврат)' : ''))); li.appendChild(el('span', 'pay__s', money(p.sumKop / 100))); li.appendChild(el('span', 'pay__d', when(p.at))); pay.appendChild(li); });
    if (!d.payments.length) pay.appendChild(el('li', 'hist__e', 'Оплат пока нет.'));
    const h = $('[data-c-hist]'); h.textContent = '';
    d.history.forEach(x => h.appendChild(histItem({ text: logText(x), note: x.note, when: when(x.at), who: x.who }, true)));
    if (!d.history.length) h.appendChild(el('li', 'hist__e', 'Пока ничего не менялось.'));
  };
  const drawClient = id => {
    const c = byId(id); if (!c) { location.replace('#/clients'); return false; }
    cur = c; const st = stateOf(c);
    const ava = $('[data-c-ava]'); ava.className = 'ava ava--lg ava--' + st; ava.textContent = c.name[0];
    $('#h-client').textContent = c.name;
    $('[data-c-plan]').textContent = c.plan ? 'Тариф «' + c.plan + '»' + (c.weeks ? ' · ' + c.weeks + ' ' + plural(c.weeks, 'неделя', 'недели', 'недель') : '') : 'Тариф не выбран';
    $('[data-c-acc]').classList.toggle('acc--bad', st === 'bad');
    $('[data-c-kicker]').textContent = c.state === 'none' ? 'доступа пока нет' : st === 'bad' ? (c.closed ? 'доступ закрыт' : 'доступ закончился') : 'доступ открыт до';
    $('[data-c-date]').textContent = c.state === 'none' ? '—' : fmt(c.until);
    const sub = $('[data-c-sub]'); sub.textContent = ''; sub.appendChild(el('span', 'stat stat--' + st, c.state === 'none' ? 'нет доступа' : STAT[st]));
    sub.appendChild(el('span', '', c.state === 'none' ? 'нажми «открыть доступ»' : st === 'bad' ? (c.closed ? 'закрыт ' : 'закончился ') + agoText(c.daysAgo || 0) : 'осталось ' + dayWord(c.daysLeft)));
    $('[data-c-extend]').textContent = st === 'bad' ? 'открыть доступ' : 'продлить';
    $('[data-c-close]').hidden = st === 'bad';
    $('[data-c-remind]').textContent = c.reminded ? 'написать ещё раз о продлении' : 'напомнить о продлении';
    $('[data-c-remind]').hidden = c.state !== 'warn' && c.state !== 'bad';
    $('[data-c-note]').value = c.note || '';
    const f = $('[data-c-form]'); f.elements.name.value = c.name; f.elements.email.value = c.email; f.elements.phone.value = c.phone; $('[data-c-err]').textContent = '';
    $('[data-c-pay]').textContent = ''; $('[data-c-hist]').textContent = '';
    const mine = c.id;
    api.get('/api/admin/clients/' + mine).then(r => { if (r.ok && cur && cur.id === mine) fillDetail(r.data); else if (!r.ok) fail(r); });
    return true;
  };
  const reloadClient = async () => { await loadClients(); if (cur && byId(cur.id) && location.hash.startsWith('#/client/')) drawClient(cur.id); };

  $('[data-c-note]').addEventListener('change', async e => {
    if (!cur) return; const c = cur, v = e.target.value.trim();
    if (v === (c.note || '')) return;
    const r = await api.request('PATCH', '/api/admin/clients/' + c.id, { note: v });
    if (!r.ok) { fail(r); return; } c.note = v; toast('Заметка сохранена');
  });
  $('[data-c-remind]').addEventListener('click', async () => { if (cur) { await remind(cur); if (location.hash.startsWith('#/client/')) drawClient(cur.id); } });
  $('[data-c-wa]').addEventListener('click', () => { if (cur) contact(cur, 'Привет, ' + first(cur.name) + '!'); });
  $('[data-c-form]').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget, err = $('[data-c-err]'); err.textContent = '';
    const body = { name: f.elements.name.value.trim(), email: f.elements.email.value.trim(), phone: f.elements.phone.value.trim() };
    if (!body.name) { err.textContent = 'Напиши имя.'; f.elements.name.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) { err.textContent = 'Проверь почту: похоже, опечатка.'; f.elements.email.focus(); return; }
    const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await api.request('PATCH', '/api/admin/clients/' + cur.id, body); btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); err.textContent = r.data.error; return; }
    await reloadClient(); toast('Данные сохранены');
  });

  /* Продлить / открыть. Недели считаются по 7 дней от текущей даты окончания (или от сегодня, если доступ закончился). */
  const OPTS = [['24 часа', 1], ['+1 неделя', 7], ['+2 недели', 14], ['+4 недели', 28], ['+8 недель', 56], ['+16 недель', 112]];   // [подпись, дней]
  const DEF_OPT = 3;
  const fx = $('[data-form="extend"]'), optBox = $('[data-dx-opts]'), newLine = $('[data-dx-new]'), tSel = $('[data-dx-tariff]'), dxErr = $('[data-dx-err]');
  const base = c => (c.until && (c.state === 'ok' || c.state === 'warn') ? c.until : new Date());
  const pick = () => { const r = $('input:checked', optBox); return OPTS[Number(r ? r.value : DEF_OPT)]; };
  const newDate = () => addDays(base(cur), pick()[1]);
  const drawNew = () => { newLine.textContent = 'Доступ будет открыт до ' + fmt(newDate()); };
  const setOpt = i => { $$('input', optBox)[i].checked = true; drawNew(); };
  OPTS.forEach((o, i) => {
    const l = el('label', 'pill'); const r = el('input'); r.type = 'radio'; r.name = 'span'; r.value = String(i); if (i === DEF_OPT) r.checked = true;
    r.addEventListener('change', drawNew); l.appendChild(r); l.appendChild(el('span', '', o[0])); optBox.appendChild(l);
  });
  /* Выбрали тариф — срок подставляется по нему (месяц = 4 недели, «24 часа» = 1 день); при желании меняется руками */
  tSel.addEventListener('change', () => { const t = accessTariffs.find(x => x.id === tSel.value); const i = t ? OPTS.findIndex(o => o[1] === t.days) : -1; setOpt(i > -1 ? i : DEF_OPT); });
  $('[data-c-extend]').addEventListener('click', () => {
    if (!cur) return; const bad = stateOf(cur) === 'bad';
    $('[data-dx-title]').textContent = bad ? 'Открыть доступ' : 'Продлить доступ';
    $('[data-dx-ok]').textContent = bad ? 'открыть' : 'продлить';
    $('[data-dx-who]').textContent = cur.name + (cur.plan ? ', сейчас тариф «' + cur.plan + '»' : '');
    tSel.textContent = '';
    if (!cur.tariffId) { const o = el('option', '', 'Выбери тариф'); o.value = ''; tSel.appendChild(o); }
    accessTariffs.forEach(t => { const o = el('option', '', t.name + (t.weeks ? ' · ' + t.weeks + ' ' + plural(t.weeks, 'неделя', 'недели', 'недель') : '')); o.value = t.id; tSel.appendChild(o); });
    tSel.value = cur.tariffId || ''; if (tSel.value !== (cur.tariffId || '')) tSel.value = '';
    dxErr.textContent = ''; $('[data-dx-note]').value = '';
    setOpt(DEF_OPT); openDlg('extend');
  });
  fx.addEventListener('submit', async e => {
    e.preventDefault(); const c = cur; dxErr.textContent = '';
    if (!tSel.value) { dxErr.textContent = 'Выбери тариф.'; tSel.focus(); return; }
    const btn = $('[data-dx-ok]'); btn.disabled = true;
    const r = await api.post('/api/admin/clients/' + c.id + '/access', { days: pick()[1], tariffId: tSel.value, note: $('[data-dx-note]').value.trim() });
    btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); dxErr.textContent = r.data.error; return; }
    dlg('extend').close(); await reloadClient();
    const pid = r.data.periodId;
    toast('Доступ до ' + fmt(new Date(r.data.endsAt)), 'отменить', async () => {
      const u = await api.post('/api/admin/clients/' + c.id + '/access/undo', { periodId: pid });
      if (!u.ok) { fail(u); return; }
      await reloadClient(); toast('Отменено');
    });
  });
  const fcl = $('[data-form="close"]');
  $('[data-c-close]').addEventListener('click', () => {
    if (!cur) return;
    $('[data-dcl-text]').textContent = cur.name + ' перестанет открывать видео. Данные и история останутся, открыть доступ можно в любой момент: срок тогда считается заново от этого дня.';
    $('[data-dcl-note]').value = ''; $('[data-dcl-err]').textContent = ''; openDlg('close');
  });
  fcl.addEventListener('submit', async e => {
    e.preventDefault(); const c = cur, btn = fcl.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await api.post('/api/admin/clients/' + c.id + '/access/close', { note: $('[data-dcl-note]').value.trim() });
    btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); $('[data-dcl-err]').textContent = r.data.error; return; }
    dlg('close').close(); await reloadClient(); toast('Доступ закрыт');
  });

  /* ---------- Контент: тренировки (группы и видео) ---------- */
  const loadContent = async () => {
    const r = await api.get('/api/admin/videos');
    if (!r.ok) { if (r.status === 401) fail(r); return false; }
    raw.groups = r.data.groups.map(g => ({ id: g.id, name: g.name, on: g.visible }));
    raw.videos = r.data.videos.map(v => ({ ...v, group: v.groupId, on: v.published }));
    return true;
  };
  const UP = window.NikaUpload;
  const RUNNING = ['prepare', 'uploading', 'offline', 'finishing'];
  const upOf = id => { const u = UP.current(); return u && u.videoId === id ? u : null; };
  const mb = b => (b / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: b < 10 * 1048576 ? 1 : 0 }) + ' МБ';

  const open = new Set();   // свёрнутые группы
  const vMeta = v => {
    const u = upOf(v.id);
    if (u && RUNNING.includes(u.state.phase)) return u.state.phase === 'offline' ? 'нет связи, загрузка на паузе' : 'загружается, ' + u.state.pct + '%';
    if (u && u.state.phase === 'error') return 'загрузка остановилась, открой и нажми «повторить»';
    if (v.upload && v.status !== 'ready') return 'загрузка прервалась, открой, чтобы продолжить';
    if (v.status === 'empty' || v.status === 'uploading') return 'нет файла';
    if (v.status === 'failed') return 'файл не загрузился';
    return v.on ? 'опубликовано' : 'файл загружен, не опубликовано';
  };
  const drawVideos = () => {
    const box = $('[data-groups]'); box.textContent = '';
    const total = raw.videos.length, hid = raw.videos.filter(v => !v.on).length;
    $('[data-v-sum]').textContent = total + ' видео в ' + raw.groups.length + ' ' + plural(raw.groups.length, 'группе', 'группах', 'группах') + (hid ? ', не опубликовано ' + hid : '');
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
        const li = el('li', 'vi' + (!v.on ? ' is-off' : '')); li.dataset.id = v.id;
        const gr = el('button', 'grip'); gr.type = 'button'; gr.dataset.grip = ''; gr.appendChild(icon('i-grip'));
        gr.setAttribute('aria-label', 'Переместить «' + v.title + '». Стрелки вверх и вниз меняют место.');
        li.appendChild(gr); li.appendChild(el('span', 'vi__no'));
        const a = el('a', 'vi__go'); a.href = '#/video/' + v.id;
        const b = el('span'); b.appendChild(el('span', 'vi__n', v.title)); b.appendChild(el('span', 'vi__s', vMeta(v))); a.appendChild(b);
        if (!v.on) a.appendChild(el('span', 'stat stat--off', v.status === 'ready' ? 'скрыто' : 'нет файла'));
        li.appendChild(a); ul.appendChild(li);
      });
      sortable(ul, async ids => {
        const r = await api.post('/api/admin/videos/order', { groupId: g.id, ids });
        if (!r.ok) { if (r.status === 401) return fail(r); toast(r.data.error); }
        await loadContent(); if (!r.ok) drawVideos();
      });
      if (list.length) body.appendChild(ul);
      const add = el('a', 'grp__add'); add.href = '#/video/new?g=' + g.id; add.appendChild(icon('i-plus')); add.appendChild(document.createTextNode('добавить видео в «' + g.name + '»'));
      body.appendChild(add); card.appendChild(body); box.appendChild(card);
    });
    if (!raw.groups.length) box.appendChild(el('p', 'empty-line', 'Групп пока нет. Нажми «+ группа», чтобы начать.'));
  };

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
  $('[data-form="group"]').addEventListener('submit', async e => {
    e.preventDefault(); const n = $('[data-dg-name]').value.trim();
    if (!n) { $('[data-dg-err]').textContent = 'Напиши название группы.'; $('[data-dg-name]').focus(); return; }
    const body = { name: n, visible: $('[data-dg-on]').checked }, was = gEdit;
    const r = was ? await api.request('PATCH', '/api/admin/video-groups/' + was.id, body) : await api.post('/api/admin/video-groups', body);
    if (!r.ok) { if (r.status === 401) return fail(r); $('[data-dg-err]').textContent = r.data.error; return; }
    await loadContent(); dlg('group').close(); drawVideos(); toast(was ? 'Группа сохранена' : 'Группа добавлена');
  });
  const moveGroup = async d => {
    const i = raw.groups.indexOf(gEdit), j = i + d;
    if (!gEdit || j < 0 || j >= raw.groups.length) { toast(d < 0 ? 'Это уже первая группа' : 'Это уже последняя группа'); return; }
    const ids = raw.groups.map(g => g.id); ids.splice(j, 0, ids.splice(i, 1)[0]);
    const r = await api.post('/api/admin/video-groups/order', { ids });
    if (!r.ok) { if (r.status === 401) return fail(r); toast(r.data.error); return; }
    await loadContent(); gEdit = gById(gEdit.id); drawVideos(); toast('Группа теперь ' + (j + 1) + '-я из ' + raw.groups.length);
  };
  $('[data-dg-up]').addEventListener('click', () => moveGroup(-1));
  $('[data-dg-down]').addEventListener('click', () => moveGroup(1));
  $('[data-dg-del]').addEventListener('click', async () => {
    const g = gEdit; if (!g) return; dlg('group').close();
    const r = await api.del('/api/admin/video-groups/' + g.id);
    if (!r.ok) { if (r.status === 401) return fail(r); toast(r.data.error); return; }
    await loadContent(); drawVideos();
    toast('Группа удалена', 'вернуть', async () => { await api.post('/api/admin/video-groups', { name: g.name, visible: g.on !== false }); await loadContent(); drawVideos(); });
  });

  /* ---------- Редактор видео ---------- */
  let ve = null;   // { v, isNew, tags }
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

  /* «Опубликовать» доступно только для загруженного файла */
  const pubSw = vf.elements.on, pubRow = pubSw.closest('.sw-row');
  const drawPublish = () => {
    const ready = !!(ve && ve.v && ve.v.status === 'ready');
    pubSw.disabled = !ready; if (!ready) pubSw.checked = false;
    pubRow.classList.toggle('is-locked', !ready);
    $('[data-ve-vis-s]').textContent = !ready ? 'Включится, когда файл загрузится до конца.' : pubSw.checked ? 'Клиенты видят это видео в своём кабинете.' : 'Пока выключено, клиенты это видео не видят.';
  };
  pubSw.addEventListener('change', drawPublish);

  /* Карточка файла: пусто, загрузка, нет связи, ошибка, готово */
  const upCard = $('[data-up]'), upErr = $('[data-up-err]'), player = $('[data-up-player]');
  const resetPlayer = () => { player.textContent = ''; player.hidden = true; };
  const drawUp = () => {
    if (!ve) return;
    const v = ve.v, u = v ? upOf(v.id) : null, st = u ? u.state : null;
    const running = !!st && st.phase !== 'done' && st.phase !== 'canceled';
    const ready = !!v && v.status === 'ready';
    $('[data-up-run]').hidden = !running;
    $('[data-up-ok]').hidden = running || !ready;
    $('[data-up-drop]').hidden = running || ready;
    upCard.classList.toggle('up--offline', running && st.phase === 'offline');
    upCard.classList.toggle('up--error', running && st.phase === 'error');
    if (running) {
      resetPlayer();
      $('[data-up-name]').textContent = st.fileName;
      $('[data-up-pct]').textContent = st.pct + '%';
      const bar = $('[data-up-bar]'); bar.style.setProperty('--p', st.pct); bar.setAttribute('aria-valuenow', String(st.pct));
      $('[data-up-s]').textContent = {
        prepare: 'Готовлю загрузку…',
        uploading: mb(st.loaded) + ' из ' + mb(st.total) + '. Не закрывай вкладку.',
        offline: 'Нет связи. Продолжим сами, как только интернет вернётся.',
        finishing: 'Собираю файл и проверяю…',
        error: st.error
      }[st.phase] || '';
      $('[data-up-retry]').hidden = st.phase !== 'error';
      $('[data-up-cancel]').textContent = st.phase === 'error' ? 'отменить' : 'отменить загрузку';
    } else if (ready) {
      $('[data-up-ok-t]').textContent = 'Файл загружен' + (v.sizeBytes ? ', ' + mb(v.sizeBytes) : '');
    } else {
      $('[data-ve-file-t]').textContent = v && v.upload ? (ve.resumePct ? 'Загрузка прервалась на ' + ve.resumePct + '%. ' : 'Загрузка прервалась. ') + 'Выбери тот же файл, докачаем остальное'
        : v && v.status === 'failed' ? 'Файл не загрузился. Выбери его ещё раз' : 'Выбрать видеофайл';
      $('[data-up-drop]').classList.toggle('is-set', false);
    }
    drawPublish();
  };

  const cardBody = () => {
    const f = vf.elements;
    return { title: f.title.value.trim(), groupId: vgSel.value, pos: Number(vpSel.value) - 1, text: f.text.value.trim(), gear: ve.tags.slice(), published: !pubSw.disabled && pubSw.checked };
  };

  const pickFile = async input => {
    const file = input.files[0]; input.value = ''; upErr.textContent = '';
    if (!file || !ve) return;
    const u = UP.current();
    if (u && RUNNING.includes(u.state.phase)) { upErr.textContent = ve.v && u.videoId === ve.v.id ? 'Загрузка уже идёт.' : 'Сейчас загружается другое видео. Дождись конца, потом выбирай следующее.'; return; }
    const why = await UP.checkFile(file);
    if (why) { upErr.textContent = why; return; }
    if (u) UP.clear();   // от прошлой загрузки осталась ошибка — начинаем новую
    if (!ve.v) {
      /* Новое видео: сначала карточка (из того, что уже введено), потом файл. Название по умолчанию — имя файла. */
      const f = vf.elements;
      if (!f.title.value.trim()) f.title.value = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').slice(0, 80);
      const r = await api.post('/api/admin/videos', cardBody());
      if (!r.ok) { if (r.status === 401) return fail(r); upErr.textContent = r.data.error; return; }
      await loadContent();
      UP.start(r.data.id, file);
      location.replace('#/video/' + r.data.id);
      toast('Файл загружается. Название и описание можно править прямо сейчас.');
      return;
    }
    UP.start(ve.v.id, file); drawUp();
  };
  $('[data-ve-file]').addEventListener('change', e => pickFile(e.target));
  $('[data-up-replace]').addEventListener('change', e => pickFile(e.target));
  $('[data-up-retry]').addEventListener('click', () => { const u = UP.current(); if (u) u.retry(); });
  $('[data-up-cancel]').addEventListener('click', () => {
    const u = UP.current(); if (!u) return;
    if (u.state.phase === 'error') { u.cancel(); return; }
    confirmDlg('Отменить загрузку?', 'Уже загруженная часть файла удалится. Начать можно будет заново.', 'отменить загрузку', () => u.cancel());
  });
  $('[data-up-watch]').addEventListener('click', async () => {
    if (!ve || !ve.v) return; upErr.textContent = '';
    const r = await api.get('/api/admin/videos/' + ve.v.id + '/play');
    if (!r.ok) { if (r.status === 401) return fail(r); upErr.textContent = r.data.error; return; }
    resetPlayer();
    const vid = document.createElement('video');
    vid.controls = true; vid.playsInline = true; vid.preload = 'metadata'; vid.src = r.data.url;
    vid.setAttribute('controlslist', 'nodownload');
    player.appendChild(vid); player.hidden = false; vid.play().catch(() => {});
  });

  /* Загрузчик сообщает о каждом шаге: обновляем только то, что на экране */
  UP.subscribe(u => {
    if (!u || u.state.phase === 'canceled') {
      loadContent().then(() => { if (ve && ve.v) ve.v = vById(ve.v.id) || ve.v; if (routeName === 'video') drawUp(); if (routeName === 'content') drawVideos(); });
      return;
    }
    if (u.state.phase === 'done') {
      loadContent().then(() => {
        const v = vById(u.videoId);
        if (ve && ve.v && ve.v.id === u.videoId) ve.v = v || ve.v;
        UP.clear();
        if (routeName === 'video') drawUp(); if (routeName === 'content') drawVideos();
        toast('«' + (v ? v.title : 'Видео') + '» загружено. Посмотри и включи «Опубликовать».');
      });
      return;
    }
    if (routeName === 'video' && ve && ve.v && ve.v.id === u.videoId) drawUp();
    if (routeName === 'content') { const v = vById(u.videoId), s = $('.vi[data-id="' + u.videoId + '"] .vi__s'); if (s && v) s.textContent = vMeta(v); }
  });

  const drawVideoEd = (id, gid) => {
    const isNew = id === 'new', v = isNew ? null : vById(id);
    if (!isNew && !v) { location.replace('#/content'); return false; }
    if (!raw.groups.length) { toast('Сначала добавь группу'); location.replace('#/content'); return false; }
    ve = { v, isNew, tags: v ? v.gear.slice() : [], resumePct: null };
    $('[data-ve-h]').textContent = isNew ? 'Новое видео' : v.title;
    vgSel.textContent = ''; raw.groups.forEach(g => { const o = el('option', '', g.name); o.value = g.id; vgSel.appendChild(o); });
    const f = vf.elements; f.title.value = v ? v.title : ''; f.text.value = v ? v.text : '';
    vgSel.value = v ? v.group : (gById(gid) ? gid : raw.groups[0].id);
    vpSel.value = v ? String(inGroup(v.group).indexOf(v) + 1) : ''; drawPos();
    pubSw.checked = v ? v.on : false;
    $('[data-ve-err]').textContent = ''; upErr.textContent = ''; resetPlayer(); drawTags(); drawUp();
    $('[data-ve-del]').hidden = isNew;
    /* Прерванная загрузка: узнаём, сколько уже в хранилище */
    if (v && v.upload && !upOf(v.id)) {
      api.get('/api/admin/uploads/' + v.upload.id + '/parts').then(r => {
        if (r.ok && ve && ve.v === v) { ve.resumePct = Math.floor(r.data.doneBytes / r.data.sizeBytes * 100); drawUp(); }
      });
    }
    return true;
  };
  vf.addEventListener('submit', async e => {
    e.preventDefault(); const b = cardBody(), err = $('[data-ve-err]'); err.textContent = '';
    if (!b.title) { err.textContent = 'Напиши название, чтобы клиенты нашли видео.'; vf.elements.title.focus(); return; }
    const btn = vf.querySelector('[type="submit"]'); btn.disabled = true;
    const r = ve.v ? await api.request('PATCH', '/api/admin/videos/' + ve.v.id, b) : await api.post('/api/admin/videos', b);
    btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); err.textContent = r.data.error; return; }
    await loadContent();
    toast(ve.v ? 'Сохранено' : 'Видео добавлено. Теперь выбери файл.');
    location.hash = ve.v ? '#/content' : '#/video/' + r.data.id;
  });
  $('[data-ve-del]').addEventListener('click', () => {
    const v = ve.v; if (!v) return;
    confirmDlg('Удалить видео?', '«' + v.title + '» пропадёт из кабинета всех клиентов, файл удалится насовсем. Если не уверена, лучше выключи «Опубликовать».', 'удалить', async () => {
      const u = upOf(v.id); if (u && RUNNING.includes(u.state.phase)) await u.cancel();
      const r = await api.del('/api/admin/videos/' + v.id);
      if (!r.ok) { if (r.status === 401) return fail(r); toast(r.data.error); return; }
      await loadContent(); location.hash = '#/content'; toast('Видео удалено');
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
    priceList.forEach(t => {
      const box = el('div', 'tcard'); if (t.group) box.appendChild(el('p', 'tcard__g', t.group)); box.appendChild(el('p', 'tcard__n', t.name));
      const g = el('div', 'tcard__f');
      const fld = (lab, val, name) => { const l = el('label', 'field'); l.appendChild(el('span', 'field__label', lab)); const i = el('input', 'field__input'); i.type = 'text'; i.inputMode = 'numeric'; i.value = val || ''; i.name = name; i.autocomplete = 'off'; l.appendChild(i); return [l, i]; };
      const [l1, i1] = fld('Цена, ₽', t.price, 'price'), [l2, i2] = fld('Старая цена, ₽', t.old, 'old');
      g.appendChild(l1); g.appendChild(l2); box.appendChild(g);
      const err = el('p', 'field__err'); err.setAttribute('role', 'alert'); box.appendChild(err);
      const act = el('div', 'tcard__act'); const sv = el('button', 'btn btn--red', 'сохранить'); sv.type = 'submit'; act.appendChild(sv); box.appendChild(act);
      box.addEventListener('submit', e => e.preventDefault());
      sv.addEventListener('click', async e => {
        e.preventDefault(); const p = num(i1.value), o = i2.value.trim() ? num(i2.value) : 0;
        i1.removeAttribute('aria-invalid'); i2.removeAttribute('aria-invalid'); err.textContent = '';
        if (!p) { err.textContent = 'Укажи цену цифрами.'; i1.setAttribute('aria-invalid', 'true'); i1.focus(); return; }
        if (o && o <= p) { err.textContent = 'Старая цена должна быть выше новой, иначе скидки нет.'; i2.setAttribute('aria-invalid', 'true'); i2.focus(); return; }
        sv.disabled = true; const r = await api.request('PATCH', '/api/admin/tariffs/' + t.id, { price: p, old: o }); sv.disabled = false;
        if (!r.ok) { if (r.status === 401) return fail(r); err.textContent = r.data.error; return; }
        t.price = p; t.old = o; i1.value = p; i2.value = o || ''; toast('Цена «' + t.name + '» сохранена');
      });
      f.appendChild(box);
    });
    if (!priceList.length) f.appendChild(el('p', 'empty-line', 'Тарифов пока нет.'));
  };

  /* ---------- Журнал, выход, сброс демо ---------- */
  const drawLog = () => {
    const ul = $('[data-log]'); ul.textContent = '';
    logList.forEach(x => ul.appendChild(histItem({ text: logText(x) + (x.client ? ' · ' + x.client : ''), note: x.note, when: when(x.at), who: x.who }, true)));
    if (!logList.length) ul.appendChild(el('li', 'hist__e', 'Пока ничего не менялось.'));
  };
  $$('[data-logout]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); window.NikaApi.logout('admin'); }));
  $('[data-reset-demo]').addEventListener('click', () => confirmDlg('Сбросить демо?', 'Вернутся демо-материалы и заявки. Клиенты, доступы, цены и видео не затрагиваются.', 'сбросить', () => { try { localStorage.removeItem(CONTENT); } catch (_) {} location.hash = '#/'; location.reload(); }));

  /* ---------- Роутер ---------- */
  const views = $$('[data-view]');
  const NAV = { today: 'today', clients: 'clients', client: 'clients', content: 'content', video: 'content', material: 'content', leads: 'leads', more: 'more', prices: 'more', log: 'more' };
  const TITLES = { today: 'Сегодня', clients: 'Клиенты', client: 'Клиент', content: 'Контент', video: 'Видео', material: 'Материал', leads: 'Заявки', more: 'Ещё', prices: 'Тарифы и цены', log: 'Журнал' };
  let firstRun = true, routeName = '';
  const DRAW = { today: drawToday, clients: drawClients, leads: drawLeads, prices: drawPrices, log: drawLog };
  const FRESH = { today: () => Promise.all([loadClients(), loadPurchases()]), clients: loadClients, prices: loadPrices, log: loadLog };
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
      if (tab === 'videos') { drawVideos(); loadContent().then(ok => { if (ok && routeName === 'content' && !$('[data-pane="videos"]').hidden) drawVideos(); }); } else drawMaterials();
    }
    if ((name === 'prices' || name === 'log') && !canMoney) { location.replace('#/more'); return; }
    routeName = name;
    (DRAW[name] || (() => {}))();
    /* Сначала рисуем то, что уже загружено, потом тихо обновляем с сервера */
    if (FRESH[name]) FRESH[name]().then(() => { if (routeName === name) DRAW[name](); });
    updateDot();
    views.forEach(v => { v.hidden = v.dataset.view !== name; });
    $$('[data-nav]').forEach(a => { if (a.dataset.nav === NAV[name]) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = TITLES[name] + ' — админка Ники';
    window.scrollTo(0, 0);
    if (!firstRun) { const h = $('[data-view="' + name + '"] h1'); if (h) h.focus({ preventScroll: true }); }
    firstRun = false;
  };
  window.addEventListener('hashchange', route);
  await Promise.all([loadClients(), loadPurchases(), loadAccessTariffs(), loadPrices(), loadContent()]);
  route();
}
})();
