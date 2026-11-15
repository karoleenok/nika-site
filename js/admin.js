/* Админка Ники. Экраны по hash: #/ #/clients #/client/ID #/content #/content/materials
   #/video/ID|new #/material/ID|new #/leads #/more #/prices #/services #/log.
   Клиенты, доступы, цены и журнал приходят с сервера (js/api.js), роль проверяет сервер.
   Группы и видео тоже с сервера (фаза 3), файлы грузит js/uploader.js прямо в хранилище.
   Заявки с сервера (фаза 5). Материалы с сервера: обложка в базе, файл прямо в хранилище по подписанной ссылке.
   Всё из данных вставляется через textContent. */
(() => {
  'use strict';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
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
  /* Группы, видео и материалы живут на сервере (loadContent, loadMaterials). */
  const raw = { groups: [], videos: [], extras: [] };
  let materialsLoaded = false;
  const vById = id => raw.videos.find(v => v.id === id);
  const gById = id => raw.groups.find(g => g.id === id);
  const inGroup = gid => raw.videos.filter(v => v.group === gid);

  /* ---------- Данные с сервера ---------- */
  /* Клиенты, доступы, цены, журнал, группы, видео и материалы живут на сервере. */
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
  let leads = [], canQuiz = false;
  const loadLeads = async () => { const r = await api.get('/api/admin/leads'); if (!r.ok) { fail(r); return; } leads = r.data.leads; canQuiz = r.data.canQuiz; updateDot(); };
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
      case 'client.delete': return 'Удалён клиент, созданный по ошибке';
      case 'client.update': return 'Изменены данные клиента';
      case 'client.note': return 'Изменена заметка о клиенте';
      case 'client.remind': return 'Отправлено напоминание о продлении';
      case 'client.view': return 'Открыт кабинет клиента в режиме просмотра';
      case 'client.password': return m.reset ? 'Выдан новый пароль для входа в кабинет' : 'Задан пароль для входа в кабинет';
      case 'access.open': return 'Доступ открыт' + (e ? ' до ' + fmt(e) : '');
      case 'access.extend': return 'Доступ продлён' + (e ? ' до ' + fmt(e) : '');
      case 'access.undo': return 'Отменено последнее продление';
      case 'access.close': return 'Доступ закрыт';
      case 'lead.done': return 'Заявка отмечена обработанной';
      case 'lead.reopen': return 'Заявка возвращена в новые';
      case 'lead.delete': return 'Заявка удалена вместе с ответами теста';
      case 'lead.quiz_view': return 'Просмотр ответов теста (заявка №' + (x.target || '') + ')';
      case 'order.paid': return 'Оплата «' + (m.title || '') + '», ' + money((m.sumKop || 0) / 100) + (m.test ? ' (тест)' : '');
      case 'order.manual': return 'Оплата «' + (m.title || '') + '» отмечена вручную';
      case 'order.refund': return 'Возврат «' + (m.title || '') + '», ' + money((m.sumKop || 0) / 100);
      case 'tariff.price': return 'Цена «' + (m.name || '') + '»: ' + money(m.from) + ' → ' + money(m.to);
      case 'service.create': return 'Добавлен сервис «' + (m.name || '') + '»';
      case 'service.update': return 'Сервис «' + (m.name || '') + '»: изменено' + (m.until ? ', хватит до ' + fmt(new Date(m.until + 'T00:00:00')) : '');
      case 'service.delete': return 'Удалён сервис «' + (m.name || '') + '»';
      case 'password_change': return 'Изменён пароль для входа в админку';
      case 'material.create': return 'Добавлен материал «' + (m.title || '') + '»';
      case 'material.update': return 'Изменён материал «' + (m.title || '') + '»';
      case 'material.delete': return 'Удалён материал «' + (m.title || '') + '»';
      case 'material.cover': return 'Заменена обложка материала';
      case 'material.file': return 'Загружен файл материала' + (m.name ? ' «' + m.name + '»' : '');
      case 'settings.videos_soon': return m.on ? 'Включён показ уроков «скоро» в кабинете' : 'Выключен показ уроков «скоро» в кабинете';
      default: return 'Действие: ' + x.action;
    }
  };


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
    /* data-sticky: окно нельзя закрыть мимо кнопки (в нём пароль, который показывается один раз) */
    d.addEventListener('click', e => { if (e.target === d && !d.hasAttribute('data-sticky')) d.close(); });
    d.addEventListener('cancel', e => { if (d.hasAttribute('data-sticky')) e.preventDefault(); });
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
    const list = sorted().filter(c => (cf.f === 'all' || stateOf(c) === cf.f) && (!q || (c.name + ' ' + c.email + ' ' + c.phone + ' ' + String(c.phone || '').replace(/\D/g, '')).toLowerCase().includes(q)));
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

  /* Смена пароля админа */
  const fpw = $('[data-form="pass"]');
  $('[data-change-pass]').addEventListener('click', () => { fpw.reset(); $('[data-dp-err]').textContent = ''; openDlg('pass'); fpw.elements.current.focus(); });
  fpw.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget, err = $('[data-dp-err]'); err.textContent = '';
    if (f.elements.password.value !== f.elements.again.value) { err.textContent = 'Новые пароли не совпадают.'; f.elements.again.focus(); return; }
    const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await api.put('/api/admin/password', { current: f.elements.current.value, password: f.elements.password.value }); btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); err.textContent = r.data.error; return; }
    dlg('pass').close(); toast('Пароль изменён');
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
    drawPass(c);
    $('[data-c-del]').hidden = !canMoney;
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
    // Клиент без почты входит по телефону: пустую почту не отправляем, логином остаётся номер
    if (!body.email && !cur.email) delete body.email;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) { err.textContent = 'Проверь почту: похоже, опечатка.'; f.elements.email.focus(); return; }
    if (!cur.email && !('email' in body) && body.phone.replace(/\D/g, '').length < 10) { err.textContent = 'Клиент входит по телефону: без номера он не войдёт. Добавь почту или оставь телефон.'; f.elements.phone.focus(); return; }
    const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await api.request('PATCH', '/api/admin/clients/' + cur.id, body); btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); err.textContent = r.data.error; return; }
    await reloadClient(); toast('Данные сохранены');
  });

  /* Удалить клиента, созданного по ошибке (Ника и Каролина). С оплатами на сайте сервер не даст удалить. */
  $('[data-c-del]').addEventListener('click', () => {
    if (!cur) return; const c = cur;
    confirmDlg('Удалить клиента?', c.name + ' пропадёт из списка вместе с доступом и паролем. Вернуть нельзя. Если человек просто перестал заниматься, лучше закрой доступ.', 'удалить', async () => {
      const r = await api.del('/api/admin/clients/' + c.id);
      if (!r.ok) { if (r.status === 401) return fail(r); toast(r.data.error); return; }
      await loadClients(); location.hash = '#/clients'; toast('Клиент удалён');
    });
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
  /* ---------- Пароль клиента: сервер придумывает, показываем один раз ---------- */
  const fcp = $('[data-form="cpass"]'), cpAsk = $('[data-dcp-ask]'), cpDone = $('[data-dcp-done]'), cpPw = $('[data-dcp-pw]'), cpMsg = $('[data-dcp-msg]');
  const loginUrl = location.origin + '/lk/login.html';
  let cpText = '', cpWho = null;
  const passMsg = (c, pw, must) => 'Привет, ' + first(c.name) + '! Твой вход в личный кабинет:\n' + loginUrl + '\n\nЛогин: ' + c.login + '\nПароль: ' + pw +
    '\n\nЛогин и пароль сохранятся в кабинете в разделе «Профиль». Если не получится войти, напиши мне.';
  const drawPass = c => {
    const chip = $('[data-c-passchip]');
    $('[data-c-passstate]').hidden = !c.hasPassword; chip.className = 'stat stat--' + (c.passwordTemp ? 'warn' : 'ok'); chip.textContent = c.passwordTemp ? 'временный пароль' : 'пароль задан';
    $('[data-c-passnote]').textContent = !c.hasPassword ? 'Пароля пока нет. Задай его и отправь клиенту: он войдёт по почте и паролю, письмо с кодом не нужно.'
      : c.passwordTemp ? 'Клиент ещё не сменил пароль на свой. Если пароль потерялся, выдай новый.'
      : 'Клиент входит по своему паролю. Если он его забыл, выдай новый.';
    $('[data-c-pass]').textContent = c.hasPassword ? 'выдать новый пароль' : 'задать пароль';
  };
  /* ---------- Посмотреть кабинет как клиент: новая вкладка, только чтение ---------- */
  const vBtn = $('[data-c-view]');
  if (vBtn) vBtn.addEventListener('click', async () => {
    if (!cur) return;
    const w = window.open('', '_blank'); // открываем сразу по клику, иначе браузер заблокирует вкладку
    vBtn.disabled = true;
    const r = await api.post('/api/admin/clients/' + cur.id + '/view');
    vBtn.disabled = false;
    if (!r.ok) { if (w) w.close(); return fail(r); }
    if (w) { w.opener = null; w.location.replace(r.data.url); } else location.href = r.data.url;
  });
  const cpWipe = () => { cpPw.textContent = ''; cpText = ''; cpWho = null; cpMsg.textContent = ''; dlg('cpass').removeAttribute('data-sticky'); };
  dlg('cpass').addEventListener('close', cpWipe);
  $('[data-c-pass]').addEventListener('click', () => {
    if (!cur) return;
    cpWipe(); cpAsk.hidden = false; cpDone.hidden = true;
    $('[data-dcp-title]').textContent = cur.hasPassword ? 'Выдать новый пароль' : 'Задать пароль';
    $('[data-dcp-ok]').textContent = cur.hasPassword ? 'выдать' : 'задать';
    $('[data-dcp-text]').textContent = 'Сайт сам придумает пароль для ' + cur.name + ' и покажет его один раз. ' +
      (cur.hasPassword ? 'Прежний пароль перестанет работать, на всех устройствах клиенту придётся войти заново.' : 'Клиент войдёт по логину ' + (cur.login || cur.email) + ' и этому паролю.');
    $('[data-dcp-err]').textContent = ''; openDlg('cpass');
  });
  fcp.addEventListener('submit', async e => {
    e.preventDefault(); if (!cpAsk || cpAsk.hidden) return;
    const c = cur, btn = $('[data-dcp-ok]'), must = false; btn.disabled = true;
    const r = await api.post('/api/admin/clients/' + c.id + '/password', { mustChange: must });
    btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); $('[data-dcp-err]').textContent = r.data.error; return; }
    cpText = passMsg({ name: c.name, login: r.data.login || r.data.email }, r.data.password, must);
    $('[data-dcp-title]').textContent = 'Пароль готов';
    $('[data-dcp-url]').textContent = loginUrl.replace(/^https?:\/\//, ''); $('[data-dcp-email]').textContent = r.data.login || r.data.email; cpPw.textContent = r.data.password;
    $('[data-dcp-wa]').hidden = !waDigits(c.phone);
    cpAsk.hidden = true; cpDone.hidden = false; dlg('cpass').setAttribute('data-sticky', '');
    ($('[data-dcp-wa]').hidden ? $('[data-dcp-copy]') : $('[data-dcp-wa]')).focus();
    c.hasPassword = true; c.passwordTemp = must; drawPass(c);
  });
  $('[data-dcp-wa]').addEventListener('click', () => { const who = cpWho || cur; if (who && cpText && contact(who, cpText)) cpMsg.textContent = 'WhatsApp открыт. Проверь, что сообщение ушло.'; });
  $('[data-dcp-copy]').addEventListener('click', async () => {
    if (!cpText) return;
    let ok = false;
    try { await navigator.clipboard.writeText(cpText); ok = true; } catch (_) {
      const ta = document.createElement('textarea'); ta.value = cpText; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      dlg('cpass').appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch (_) {} ta.remove();
    }
    cpMsg.textContent = ok ? 'Скопировано. Вставь сообщение в чат с клиентом.' : 'Не получилось скопировать. Выдели пароль и скопируй вручную.';
  });

  /* ---------- Выдать доступ одним шагом: клиент оплатил в WhatsApp ----------
     Имя + телефон (почта по желанию) + тариф и срок → сервер создаёт клиента, открывает доступ и придумывает пароль.
     Сразу показываем окно с логином, паролем и готовым сообщением. Галочку можно снять: тогда просто карточка клиента. */
  const fnc = $('[data-form="newclient"]'), dnErr = $('[data-dn-err]'), dnSel = $('[data-dn-tariff]'), dnOpts = $('[data-dn-opts]'), dnNew = $('[data-dn-new]');
  const DN_OPTS = [['1 неделя', 7], ['2 недели', 14], ['4 недели', 28], ['8 недель', 56], ['12 недель', 84], ['16 недель', 112]];
  const DN_DEF = 2;
  const dnPick = () => { const r = $('input:checked', dnOpts); return DN_OPTS[Number(r ? r.value : DN_DEF)]; };
  const dnDraw = () => { dnNew.textContent = 'Доступ до ' + fmt(addDays(new Date(), dnPick()[1])); };
  const dnSet = i => { $$('input', dnOpts)[i].checked = true; dnDraw(); };
  DN_OPTS.forEach((o, i) => {
    const l = el('label', 'pill'); const r = el('input'); r.type = 'radio'; r.name = 'dnspan'; r.value = String(i);
    r.addEventListener('change', dnDraw); l.appendChild(r); l.appendChild(el('span', '', o[0])); dnOpts.appendChild(l);
  });
  /* Выбрали тариф — срок подставляется по нему; при желании меняется руками */
  dnSel.addEventListener('change', () => { const t = accessTariffs.find(x => x.id === dnSel.value); const i = t ? DN_OPTS.findIndex(o => o[1] === t.days) : -1; dnSet(i > -1 ? i : DN_DEF); });
  const openGrant = async () => {
    fnc.reset(); dnErr.textContent = '';
    if (!accessTariffs.length) await loadAccessTariffs();
    dnSel.textContent = '';
    accessTariffs.forEach(t => { const o = el('option', '', t.name + (t.weeks ? ' · ' + t.weeks + ' ' + plural(t.weeks, 'неделя', 'недели', 'недель') : '')); o.value = t.id; dnSel.appendChild(o); });
    if (accessTariffs.length) dnSel.dispatchEvent(new Event('change')); else dnSet(DN_DEF);
    openDlg('newclient'); fnc.elements.name.focus();
  };
  $('[data-cl-add]').addEventListener('click', openGrant);
  $('[data-grant]').addEventListener('click', openGrant);
  const showCreds = (c, login, password, must, title) => {
    cpWipe(); cpAsk.hidden = true; cpDone.hidden = false;
    cpText = passMsg({ name: c.name, login }, password, must); cpWho = c;
    $('[data-dcp-title]').textContent = title;
    $('[data-dcp-url]').textContent = loginUrl.replace(/^https?:\/\//, ''); $('[data-dcp-email]').textContent = login; cpPw.textContent = password;
    $('[data-dcp-wa]').hidden = !waDigits(c.phone);
    openDlg('cpass'); dlg('cpass').setAttribute('data-sticky', '');
    ($('[data-dcp-wa]').hidden ? $('[data-dcp-copy]') : $('[data-dcp-wa]')).focus();
  };
  fnc.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget; dnErr.textContent = '';
    const body = { name: f.elements.name.value.trim(), email: f.elements.email.value.trim(), phone: f.elements.phone.value.trim() };
    const digits = body.phone.replace(/\D/g, '');
    if (!body.name) { dnErr.textContent = 'Напиши имя.'; f.elements.name.focus(); return; }
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) { dnErr.textContent = 'Проверь почту: похоже, опечатка.'; f.elements.email.focus(); return; }
    if (body.phone && (digits.length < 10 || digits.length > 15)) { dnErr.textContent = 'Проверь телефон: нужно 10–15 цифр.'; f.elements.phone.focus(); return; }
    if (!body.email && !body.phone) { dnErr.textContent = 'Нужен телефон или почта: по ним клиент войдёт в кабинет.'; f.elements.phone.focus(); return; }
    if (!dnSel.value) { dnErr.textContent = 'Выбери тариф.'; dnSel.focus(); return; }
    const btn = $('[data-dn-ok]'); btn.disabled = true;
    const r = await api.post('/api/admin/clients/grant', { ...body, tariffId: dnSel.value, days: dnPick()[1], mustChange: false });
    btn.disabled = false;
    if (!r.ok) {
      if (r.status === 401) return fail(r);
      dnErr.textContent = r.data.error;
      if (r.status === 409 && r.data.id) toast('Такой клиент уже есть', 'открыть', () => { dlg('newclient').close(); location.hash = '#/client/' + r.data.id; });
      return;
    }
    dlg('newclient').close(); await loadClients(); location.hash = '#/client/' + r.data.id;
    showCreds({ name: body.name, phone: body.phone }, r.data.login, r.data.password, r.data.mustChange, 'Доступ открыт до ' + fmt(new Date(r.data.endsAt)));
  });
  $('[data-dcp-finish]').addEventListener('click', async () => { dlg('cpass').close(); await reloadClient(); toast('Пароль задан'); });

  /* ---------- Переключатель «уроки скоро» ---------- */
  const soonSw = $('[data-soon-sw]');
  const loadSettings = async () => { const r = await api.get('/api/admin/settings'); if (r.ok) soonSw.checked = !!r.data.videosSoon; };
  soonSw.addEventListener('change', async () => {
    const on = soonSw.checked; soonSw.disabled = true;
    const r = await api.request('PUT', '/api/admin/settings', { videosSoon: on });
    soonSw.disabled = false;
    if (!r.ok) { soonSw.checked = !on; fail(r); return; }
    toast(on ? 'Клиенты видят уроки с меткой «скоро»' : 'Клиенты видят только опубликованные уроки');
  });

  /* ---------- Экскурсия по админке ----------
     Карточка с шагами + рамка вокруг кнопки, о которой шаг. На каждом шаге открывается нужный экран,
     страница под карточкой остаётся рабочей, экскурсия сама ничего не меняет.
     Отметка «пройдена» хранится на сервере (у каждого админа своя), localStorage — только быстрый кэш.
     Если кнопки на экране нет (например, клиентов ещё нет), рамка встаёт на запасную цель и текст меняется. */
  const TOUR_KEY = 'nika_adm_tour_done';
  const firstClient = () => clients[0] || null;
  const TOUR = [
    { t: 'Короткая экскурсия', p: 'Покажу за минуту, какие кнопки нужны каждый день. Я ничего не меняю, только открываю экраны. Пройти заново: «Ещё» → «как пользоваться админкой».' },
    { hash: () => '#/', nav: 'today', t: 'Напомнить о продлении',
      to: '[data-todo] .btn', p: 'У этих клиентов доступ скоро закончится. Кнопка откроет WhatsApp с готовым текстом о продлении, тебе останется нажать «отправить».',
      alt: '[data-kpis]', pAlt: 'Сводка по клиентам и заявкам. Когда у кого-то доступ будет подходить к концу, ниже появится кнопка «написать в WhatsApp» с готовым текстом.' },
    { hash: () => '#/clients', nav: 'clients', t: 'Новый клиент',
      to: '[data-cl-add]', p: 'Кнопка «+ клиент»: имя, почта и телефон. Найти человека можно поиском сверху, по имени или почте.' },
    { hash: () => firstClient() ? '#/client/' + firstClient().id : '#/clients', nav: 'clients', t: 'Доступ клиента',
      to: '[data-view="client"]:not([hidden]) [data-c-acc]', p: 'Карточка клиента, открыла первого по списку. Здесь доступ: «открыть доступ» или «продлить» добавляют дни, «закрыть доступ» закрывает сразу.',
      alt: '[data-cl-add]', pAlt: 'Когда добавишь клиента, в его карточке будет доступ: открыть, продлить или закрыть.' },
    { hash: () => firstClient() ? '#/client/' + firstClient().id : '#/clients', nav: 'clients', t: 'Пароль для входа',
      to: '[data-view="client"]:not([hidden]) [data-c-pass]', p: 'Нажми, и сайт придумает пароль. Он покажется один раз, рядом будет кнопка «отправить в WhatsApp». Клиент при первом входе придумает свой.',
      alt: '[data-cl-add]', pAlt: 'В карточке клиента будет кнопка «задать пароль»: сайт придумает пароль и подготовит сообщение в WhatsApp.' },
    { hash: () => '#/content', nav: 'content', t: 'Группы и видео',
      to: '[data-g-add]', p: 'Сначала создай группу, потом добавляй в неё видео. Клиенты видят их в том же порядке, порядок меняется перетаскиванием за значок слева.' },
    { hash: () => '#/content', nav: 'content', t: 'Уроки «скоро»',
      to: '.adm-soon', p: 'Пока видео загружаются, клиенты видят их с меткой «скоро». Когда опубликуешь всё, выключи: иначе любое снятое с публикации видео тоже станет «скоро».' },
    { hash: () => '#/leads', nav: 'leads', t: 'Заявки',
      to: '[data-leads] .lead:not(.lead--empty):not(.lead--done)', p: 'Новая заявка с сайта или ответы теста. Позвони или напиши и отметь заявку обработанной, чтобы она не мешала остальным.',
      alt: '[data-leads]', pAlt: 'Сюда приходят заявки с сайта и ответы теста. Красная точка в меню значит, что есть новые.' },
    { hash: () => '#/more', nav: 'more', t: 'Ещё',
      to: '[data-tour-start]', p: (canMoney ? 'Оплаты, цены и журнал действий выше. ' : '') + 'Здесь смена пароля и эта экскурсия, если что-то забудешь.' },
  ];
  const tourEl = $('[data-tour]'), ring = $('[data-tour-ring]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const isDesk = matchMedia('(min-width: 1024px)');
  const shown = n => !!n && n.getClientRects().length > 0;
  let tourI = -1, tourTarget = null, tourTimers = [];
  /* Цель шага: кнопка на странице, иначе запасная цель, иначе пункт меню */
  const tourResolve = s => {
    const main = s.to && $(s.to), alt = s.alt && $(s.alt);
    if (shown(main)) return { n: main, p: s.p, inPage: true };
    if (shown(alt)) return { n: alt, p: s.pAlt || s.p, inPage: true };
    const nav = s.nav && $('[data-nav="' + s.nav + '"]');
    return { n: shown(nav) ? nav : null, p: s.pAlt || s.p, inPage: false };
  };
  const tourPlace = () => {
    const n = tourTarget;
    if (!shown(n)) { ring.hidden = true; return; }
    const r = n.getBoundingClientRect(), inNav = !!n.closest('.lk-nav'), pad = inNav ? -4 : 6;
    let top = r.top - pad, h = r.height + pad * 2;
    /* Рамка не залезает под карточку экскурсии (на мобилке она снизу) */
    if (!isDesk.matches && !inNav) { const lim = tourEl.getBoundingClientRect().top - 8; if (top + h > lim) h = Math.max(0, lim - top); }
    ring.style.left = (r.left - pad) + 'px'; ring.style.top = top + 'px';
    ring.style.width = (r.width + pad * 2) + 'px'; ring.style.height = h + 'px';
    ring.hidden = h < 12;
    /* На компьютере карточка в правом нижнем углу: если цель под ней, поднимаем карточку наверх */
    if (isDesk.matches) {
      const c = tourEl.getBoundingClientRect(), hit = r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom;
      if (hit) tourEl.classList.add('tour--up');
    }
  };
  /* Прокрутить так, чтобы цель была видна между шапкой и карточкой экскурсии */
  const tourScroll = n => {
    const r = n.getBoundingClientRect(), head = $('.lk-top'), topLim = (shown(head) ? head.getBoundingClientRect().bottom : 0) + 16;
    const botLim = isDesk.matches ? innerHeight - 24 : tourEl.getBoundingClientRect().top - 16;
    if (r.top >= topLim && r.bottom <= botLim) return;
    const room = botLim - topLim, dy = r.height <= room ? r.top - topLim - (room - r.height) / 2 : r.top - topLim;
    window.scrollBy({ top: dy, behavior: reduce.matches ? 'auto' : 'smooth' });
  };
  const tourAim = () => {
    const s = TOUR[tourI]; if (!s) return;
    const x = tourResolve(s); tourTarget = x.n;
    $('[data-tour-p]').textContent = x.p;
    if (x.n && x.inPage) tourScroll(x.n);
    tourPlace();
  };
  const tourShow = i => {
    tourI = i; const s = TOUR[i], last = i === TOUR.length - 1;
    tourTimers.forEach(clearTimeout); tourTimers = [];
    tourEl.classList.remove('tour--up');
    $('[data-tour-n]').textContent = 'шаг ' + (i + 1) + ' из ' + TOUR.length;
    $('[data-tour-t]').textContent = s.t; $('[data-tour-p]').textContent = s.p;
    $('[data-tour-bar]').style.width = ((i + 1) / TOUR.length * 100) + '%';
    $('[data-tour-prev]').hidden = i === 0;
    $('[data-tour-next]').textContent = i === 0 ? 'начать' : last ? 'готово' : 'дальше';
    tourTarget = null; ring.hidden = true;
    const h = s.hash && s.hash();
    if (h && location.hash !== h && !(h === '#/' && !location.hash)) location.hash = h;
    /* Экран переключается и забирает фокус на заголовок: возвращаем его на кнопку шага.
       Второй замер — после того как раздел дорисуется свежими данными с сервера. */
    tourTimers.push(setTimeout(() => { if (tourI !== i) return; tourAim(); if (!tourEl.hidden) $('[data-tour-next]').focus({ preventScroll: true }); }, 80));
    tourTimers.push(setTimeout(() => { if (tourI === i && !shown(tourTarget)) tourAim(); else if (tourI === i) tourPlace(); }, 500));
  };
  const tourSave = done => { wr(TOUR_KEY, done ? '1' : ''); api.put('/api/admin/tour', { done }); };
  const tourStart = () => { document.body.classList.add('is-touring'); tourEl.hidden = false; tourEl.classList.remove('is-in'); void tourEl.offsetWidth; tourEl.classList.add('is-in'); tourShow(0); };
  const tourEnd = () => { document.body.classList.remove('is-touring'); tourTimers.forEach(clearTimeout); tourEl.hidden = true; ring.hidden = true; tourI = -1; tourTarget = null; tourSave(true); };
  $('[data-tour-next]').addEventListener('click', () => { if (tourI >= TOUR.length - 1) { tourEnd(); toast('Экскурсия всегда под рукой: «Ещё» → «как пользоваться админкой»'); } else tourShow(tourI + 1); });
  $('[data-tour-prev]').addEventListener('click', () => { if (tourI > 0) tourShow(tourI - 1); });
  $('[data-tour-close]').addEventListener('click', tourEnd);
  $('[data-tour-start]').addEventListener('click', tourStart);
  tourEl.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); tourEnd(); } });
  window.addEventListener('resize', () => { if (tourI >= 0) tourPlace(); });
  window.addEventListener('scroll', () => { if (tourI >= 0) tourPlace(); }, { passive: true });

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
  const loadMaterials = async () => {
    const r = await api.get('/api/admin/materials');
    if (!r.ok) { fail(r); return false; }
    raw.extras = r.data.materials; materialsLoaded = true; return true;
  };
  const putMaterial = m => { const i = raw.extras.findIndex(x => x.id === m.id); if (i > -1) raw.extras[i] = m; else raw.extras.push(m); };
  const drawMaterials = () => {
    const ul = $('[data-mlist]'); ul.textContent = '';
    $('[data-m-sum]').textContent = materialsLoaded ? raw.extras.length + ' ' + plural(raw.extras.length, 'материал', 'материала', 'материалов') : 'Загружаем…';
    raw.extras.forEach(x => {
      const li = el('li'); const a = el('a', 'mrow'); a.href = '#/material/' + x.id;
      const img = el('img'); img.alt = ''; img.src = x.cover || '../favicon.png'; img.width = 64; img.height = 80; img.loading = 'lazy'; a.appendChild(img);
      const b = el('span', 'mrow__b'); b.appendChild(el('span', 'mrow__k', x.kind)); b.appendChild(el('span', 'mrow__t', x.title));
      b.appendChild(el('span', 'mrow__p', money(x.price || 0) + (x.gift ? ' · дарим' : '') + (x.sales ? ' · ' + x.sales + ' ' + plural(x.sales, 'покупка', 'покупки', 'покупок') : ''))); a.appendChild(b);
      if (!x.file && !x.page) a.appendChild(el('span', 'stat stat--warn', 'нет файла'));
      else if (x.on === false) a.appendChild(el('span', 'stat stat--off', 'скрыт'));
      li.appendChild(a); ul.appendChild(li);
    });
    if (materialsLoaded && !raw.extras.length) ul.appendChild(el('li', 'empty-line', 'Материалов пока нет. Нажми «+ материал».'));
  };
  /* Подпись поля файла: выбран файл или нет (зелёная рамка через .is-set) */
  const setFile = (box, tEl, name, def) => { box.classList.toggle('is-set', !!name); tEl.textContent = name ? name : def; };
  const FILE_EXT = /\.(pdf|mp4|m4v|mov|webm)$/i, MAX_FILE = 1024 ** 3;
  const size = b => b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' КБ' : mb(b);
  let me = null; const mf = $('[data-me]');
  const meBar = $('[data-me-bar]'), meBusy = $('[data-me-busy]'), meSave = $('[type="submit"]', mf);
  const drawMaterialEd = id => {
    const isNew = id === 'new', x = isNew ? null : raw.extras.find(e => e.id === id);
    if (!isNew && !x) {
      if (!materialsLoaded) { loadMaterials().then(ok => { if (ok && location.hash === '#/material/' + id) route(); }); return false; }
      location.replace('#/content/materials'); return false;
    }
    me = { x, isNew, cover: null, coverUrl: x ? x.cover : '', file: null };
    $('[data-me-h]').textContent = isNew ? 'Новый материал' : x.title;
    const f = mf.elements; f.kind.value = x ? x.kind : 'гайд'; f.title.value = x ? x.title : ''; f.text.value = x && x.text ? x.text : ''; f.price.value = x ? x.price || '' : ''; f.old.value = x && x.old ? x.old : '';
    f.price.disabled = f.old.disabled = !canMoney;
    f.on.checked = x ? x.on !== false : false; f.gift.checked = x ? !!x.gift : false; $('[data-me-err]').textContent = '';
    const img = $('[data-me-cover]'); img.hidden = !me.coverUrl; if (me.coverUrl) img.src = me.coverUrl;
    setFile($('[data-me-cover-in]').parentElement, $('[data-me-cover-t]'), null, me.coverUrl ? 'Заменить картинку' : 'Выбрать картинку');
    const cur = x && x.file ? x.file.name + ' · ' + size(x.file.sizeBytes) : x && x.page ? 'Страница на сайте' : null;
    setFile($('[data-me-file]').parentElement, $('[data-me-file-t]'), cur, 'Выбрать файл (PDF или видео)');
    $('[data-me-file]').value = ''; $('[data-me-cover-in]').value = '';
    $('[data-me-open]').hidden = !(x && (x.file || x.page));
    meBar.hidden = true; meBusy.textContent = '';
    $('[data-me-del]').hidden = isNew; return true;
  };
  /* Обложку сжимаем в браузере до 800 px по длинной стороне: в базу уходит ~100 КБ, а не фото с телефона на 8 МБ */
  const shrink = file => new Promise((ok, no) => {
    if (file.size > 25 * 1024 * 1024) { no(new Error('big')); return; }
    const im = new Image(), fr = new FileReader();   // data:, а не blob: — так разрешает политика безопасности (CSP)
    im.onload = () => {
      const k = Math.min(1, 800 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      const out = (type, q) => c.toDataURL(type, q);
      let d = out('image/webp', .85); let type = 'image/webp';
      if (!d.startsWith('data:image/webp')) { d = out('image/jpeg', .85); type = 'image/jpeg'; }
      ok({ type, url: d, data: d.slice(d.indexOf(',') + 1) });
    };
    im.onerror = () => no(new Error('bad'));
    fr.onload = () => { im.src = String(fr.result); }; fr.onerror = () => no(new Error('bad'));
    fr.readAsDataURL(file);
  });
  $('[data-me-cover-in]').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { me.cover = await shrink(f); } catch (_) { toast('Не получилось открыть картинку. Выбери JPG или PNG.'); e.target.value = ''; return; }
    const img = $('[data-me-cover]'); img.src = me.cover.url; img.hidden = false; setFile(e.target.parentElement, $('[data-me-cover-t]'), f.name, '');
  });
  $('[data-me-file]').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    if (!FILE_EXT.test(f.name)) { toast('Подойдёт PDF или видео MP4, MOV, WebM.'); e.target.value = ''; return; }
    if (f.size > MAX_FILE) { toast('Файл больше 1 ГБ. Сожми видео и попробуй снова.'); e.target.value = ''; return; }
    me.file = f; setFile(e.target.parentElement, $('[data-me-file-t]'), f.name + ' · ' + size(f.size), '');
  });
  /* Загрузка файла одним PUT прямо в хранилище; XHR, чтобы показать прогресс */
  const putFile = (url, headers, file) => new Promise(ok => {
    const x = new XMLHttpRequest(); x.open('PUT', url);
    Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    x.upload.onprogress = ev => { if (ev.lengthComputable) { const p = Math.round(ev.loaded / ev.total * 100); meBar.style.setProperty('--p', p); meBar.setAttribute('aria-label', 'Загружено ' + p + '%'); meBusy.textContent = 'Загружаем файл: ' + p + '%'; } };
    x.onload = () => ok(x.status >= 200 && x.status < 300); x.onerror = () => ok(false); x.send(file);
  });
  const leaveGuard = e => { e.preventDefault(); e.returnValue = ''; };
  let meWorking = false;
  mf.addEventListener('submit', async e => {
    e.preventDefault(); if (meWorking) return;
    const f = mf.elements, t = f.title.value.trim(), p = num(f.price.value), o = num(f.old.value), err = $('[data-me-err]');
    err.textContent = '';
    if (!t) { err.textContent = 'Напиши название материала.'; f.title.focus(); return; }
    if (o && o <= p) { err.textContent = 'Старая цена должна быть выше новой, иначе скидки нет.'; f.old.focus(); return; }
    const willHaveFile = me.file || (me.x && (me.x.file || me.x.page));
    if (f.on.checked && !willHaveFile) { err.textContent = 'Чтобы показать материал клиентам, загрузи файл.'; return; }
    const body = { kind: f.kind.value, title: t, text: f.text.value.trim(), gift: f.gift.checked, on: f.on.checked && !!(me.x && (me.x.file || me.x.page)) };
    if (canMoney) { body.price = p; body.old = o; }
    meWorking = true; meSave.disabled = true; meSave.setAttribute('aria-busy', 'true'); addEventListener('beforeunload', leaveGuard);
    const done = () => { meWorking = false; meSave.disabled = false; meSave.removeAttribute('aria-busy'); removeEventListener('beforeunload', leaveGuard); };
    meBusy.textContent = 'Сохраняем…';
    let r = me.isNew ? await api.post('/api/admin/materials', body) : await api.request('PATCH', '/api/admin/materials/' + me.x.id, body);
    if (!r.ok) { done(); meBusy.textContent = ''; if (r.status === 401) return fail(r); err.textContent = r.data.error; return; }
    let m = r.data.material; putMaterial(m);
    if (me.isNew) { me.isNew = false; me.x = m; history.replaceState(null, '', '#/material/' + m.id); $('[data-me-del]').hidden = false; }
    if (me.cover) {
      meBusy.textContent = 'Загружаем обложку…';
      r = await api.put('/api/admin/materials/' + m.id + '/cover', { type: me.cover.type, data: me.cover.data });
      if (r.ok) { m = r.data.material; putMaterial(m); me.cover = null; } else toast(r.data.error || 'Обложка не сохранилась. Попробуй ещё раз.');
    }
    if (me.file) {
      meBar.hidden = false; meBar.style.setProperty('--p', 0);
      const s = await api.post('/api/admin/materials/' + m.id + '/file', { name: me.file.name, size: me.file.size });
      const sent = s.ok && await putFile(s.data.url, s.data.headers, me.file);
      r = sent ? await api.post('/api/admin/materials/' + m.id + '/file/done', { name: me.file.name }) : s;
      meBar.hidden = true;
      if (!sent || !r.ok) { done(); meBusy.textContent = ''; me.x = m; err.textContent = (r.data && r.data.error) || 'Файл не загрузился. Проверь интернет и нажми «сохранить» ещё раз.'; return; }
      m = r.data.material; putMaterial(m); me.file = null;
      if (f.on.checked && !m.on) {
        r = await api.request('PATCH', '/api/admin/materials/' + m.id, { on: true });
        if (r.ok) { m = r.data.material; putMaterial(m); } else toast(r.data.error);
      }
    }
    done(); meBusy.textContent = '';
    toast(m.on ? 'Сохранено' : 'Сохранено. Материал пока скрыт от клиентов.');
    location.hash = '#/content/materials';
  });
  $('[data-me-open]').addEventListener('click', async () => {
    if (!me.x) return;
    const w = window.open('', '_blank');
    const r = await api.get('/api/admin/materials/' + me.x.id + '/open');
    if (!r.ok) { if (w) w.close(); fail(r); return; }
    if (w) { w.opener = null; w.location.href = r.data.url; } else location.href = r.data.url;
  });
  $('[data-me-del]').addEventListener('click', () => {
    const x = me.x; if (!x) return;
    confirmDlg('Удалить материал?', '«' + x.title + '» пропадёт из кабинета вместе с файлом. Если не уверена, лучше выключи «Показывать клиентам».', 'удалить', async () => {
      const r = await api.del('/api/admin/materials/' + x.id);
      if (!r.ok) { fail(r); return; }
      raw.extras = raw.extras.filter(e => e.id !== x.id); location.hash = '#/content/materials'; toast('Материал удалён');
    });
  });

  /* ---------- Заявки ---------- */
  /* Заявки с сервера. Ответы теста (данные о здоровье) сервер отдаёт только Нике (owner), каждый просмотр пишется в журнал. */
  const quizCache = new Map();
  const showQuiz = async (l, box, btn) => {
    btn.disabled = true;
    let q = quizCache.get(l.id);
    if (!q) { const r = await api.get('/api/admin/leads/' + l.id + '/quiz'); btn.disabled = false; if (!r.ok) { fail(r); return; } q = r.data; quizCache.set(l.id, q); }
    btn.remove();
    q.answers.forEach(x => {
      box.appendChild(el('p', 'lead__qt', x.q));
      const c = el('div', 'lead__q'); x.a.forEach(v => c.appendChild(el('span', '', v))); box.appendChild(c);
    });
    const a = el('div', 'lead__a', q.analyses.length ? 'Тест выделил блоки: ' + q.analyses.join(', ') + '.' : 'Тест не выделил отдельных блоков.');
    a.appendChild(el('small', '', 'Список составил тест, направление подтверждаешь ты. Согласие на данные о здоровье: ' + when(q.consentAt) + '.'));
    box.appendChild(a);
  };
  const drawLeads = () => {
    const ul = $('[data-leads]'); ul.textContent = '';
    if (!leads.length) { ul.appendChild(el('li', 'lead lead--empty', 'Заявок пока нет. Когда кто-то оставит имя и телефон на сайте, заявка появится здесь.')); return; }
    leads.forEach(l => {
      const li = el('li', 'lead' + (l.isNew ? '' : ' lead--done')); const h = el('div', 'lead__h');
      h.appendChild(el('span', 'lead__n', l.name)); if (l.isNew) h.appendChild(el('span', 'stat stat--new', 'новая'));
      h.appendChild(el('span', 'lead__m', l.service + ' · ' + when(l.createdAt)));
      li.appendChild(h);
      const tel = el('a', 'lead__tel', l.phone); tel.href = 'tel:' + l.phone; li.appendChild(tel);
      if (l.message) li.appendChild(el('p', 'lead__t', l.message));
      if (l.quiz === 'waiting') li.appendChild(el('p', 'lead__m', 'Тест ещё не пройден: человек оставил контакты, но не ответил на вопросы.'));
      if (l.quiz === 'done') {
        const box = el('div', 'lead__quiz'); li.appendChild(box);
        if (canQuiz) { const b = el('button', 'btn btn--line-dark', 'показать ответы теста'); b.type = 'button'; b.addEventListener('click', () => showQuiz(l, box, b)); box.appendChild(b); }
        else box.appendChild(el('p', 'lead__m', 'Тест пройден. Ответы видит только Ника.'));
      }
      const act = el('div', 'lead__act');
      const w = el('button', 'btn btn--red', 'ответить в WhatsApp'); w.type = 'button';
      w.addEventListener('click', () => contact({ phone: l.phone }, 'Здравствуйте, ' + first(l.name) + '! Это Ника. Получила вашу заявку с сайта.')); act.appendChild(w);
      const d = el('button', 'btn btn--line-dark', l.isNew ? 'отметить обработанной' : 'вернуть в новые'); d.type = 'button';
      d.addEventListener('click', async () => {
        d.disabled = true;
        const r = await api.post('/api/admin/leads/' + l.id + '/done', { done: l.isNew });
        d.disabled = false; if (!r.ok) { fail(r); return; }
        const was = l.isNew; l.isNew = !was; drawLeads(); updateDot();
        toast(was ? 'Заявка обработана' : 'Заявка снова в новых');
      });
      act.appendChild(d);
      if (canMoney) {
        const x = el('button', 'lead__del', 'удалить'); x.type = 'button';
        x.addEventListener('click', () => confirmDlg('Удалить заявку?', 'Заявка удалится вместе с ответами теста, вернуть не получится. Так делают, если человек попросил удалить его данные.', 'удалить', async () => {
          const r = await api.del('/api/admin/leads/' + l.id); if (!r.ok) { fail(r); return; }
          leads = leads.filter(z => z !== l); quizCache.delete(l.id); drawLeads(); updateDot(); toast('Заявка удалена');
        }));
        act.appendChild(x);
      }
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

  /* ---------- Оплаты ---------- */
  let orders = [], ordFilter = 'done', ordCur = null, ordMode = '';
  const loadOrders = async () => { if (!canMoney) return; const r = await api.get('/api/admin/orders'); if (r.ok) orders = r.data.orders; else fail(r); };
  const ORD_ST = { paid: ['оплачен', 'ok'], manual: ['отмечен вручную', 'ok'], new: ['ждёт оплаты', 'warn'], failed: ['не прошёл', ''], refunded: ['возврат', ''] };
  const drawOrders = () => {
    const ul = $('[data-orders]'); ul.textContent = '';
    const list = orders.filter(o => ordFilter === 'done' ? (o.status === 'paid' || o.status === 'manual') : ordFilter === 'new' ? (o.status === 'new' || o.status === 'failed') : o.status === 'refunded');
    list.forEach(o => {
      const li = el('li', 'ord__i'), st = ORD_ST[o.status] || [o.status, ''];
      li.appendChild(el('span', 'ord__t', o.title)); li.appendChild(el('span', 'ord__s', money(o.sumKop / 100)));
      const m = el('span', 'ord__m');
      if (o.clientId) { const a = el('a', '', o.email); a.href = '#/client/' + o.clientId; m.appendChild(a); } else m.appendChild(document.createTextNode(o.email));
      m.appendChild(document.createTextNode(' · №' + o.id + ' · ' + when(o.at) + (o.test ? ' · тест' : '')));
      li.appendChild(m);
      li.appendChild(el('span', 'ord__st' + (st[1] ? ' ord__st--' + st[1] : ''), st[0]));
      if (o.note) li.appendChild(el('span', 'ord__n', 'Заметка: ' + o.note + (o.who ? ' · ' + o.who : '')));
      const act = el('div', 'ord__act');
      const btn = (t, mode) => { const b = el('button', 'btn btn--line-dark', t); b.type = 'button'; b.addEventListener('click', () => ordOpen(o, mode)); act.appendChild(b); };
      if (o.status === 'new' || o.status === 'failed') btn('оплата пришла', 'confirm');
      if (o.status === 'paid' || o.status === 'manual') btn('оформить возврат', 'refund');
      if (act.children.length) li.appendChild(act);
      ul.appendChild(li);
    });
    if (!list.length) ul.appendChild(el('li', 'empty-line', ordFilter === 'new' ? 'Неоплаченных заказов за 2 недели нет.' : ordFilter === 'refunded' ? 'Возвратов не было.' : 'Оплат пока нет.'));
  };
  $$('[data-pay-filter] [data-f]').forEach(b => b.addEventListener('click', () => {
    ordFilter = b.dataset.f; $$('[data-pay-filter] [data-f]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); drawOrders();
  }));
  const ordOpen = (o, mode) => {
    ordCur = o; ordMode = mode;
    const sum = money(o.sumKop / 100), name = /«/.test(o.title) ? o.title : '«' + o.title + '»';
    $('[data-do-title]').textContent = mode === 'confirm' ? 'Оплата пришла?' : 'Оформить возврат?';
    $('[data-do-text]').textContent = mode === 'confirm'
      ? 'Отмечай, только если видишь оплату ' + sum + ' от ' + o.email + ' в кабинете Robokassa. Покупателю откроется «' + o.title + '» и придёт письмо.'
      : 'Сначала верни ' + sum + ' в кабинете Robokassa и проверь, что чек в «Мой налог» аннулирован. Здесь закроется «' + o.title + '» у ' + o.email + '.';
    $('[data-do-ok]').textContent = mode === 'confirm' ? 'отметить оплату' : 'отметить возврат';
    const n = $('[data-do-note]'); n.value = ''; n.placeholder = mode === 'confirm' ? 'Например: есть в Robokassa' : 'Например: передумала';
    $('[data-do-err]').textContent = ''; openDlg('order');
  };
  const fo = $('[data-form="order"]');
  fo.addEventListener('submit', async e => {
    e.preventDefault(); const note = $('[data-do-note]').value.trim(), err = $('[data-do-err]');
    if (note.length < 3) { err.textContent = 'Напиши пару слов: это увидишь потом в журнале.'; $('[data-do-note]').focus(); return; }
    const btn = fo.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await api.post('/api/admin/orders/' + ordCur.id + '/' + ordMode, { note });
    btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); err.textContent = r.data.error; return; }
    dlg('order').close(); await loadOrders(); drawOrders(); loadPurchases();
    toast(ordMode === 'confirm' ? 'Оплата отмечена, доступ открыт' : 'Возврат отмечен');
  });

  /* ---------- Сервисы и оплаты ----------
     За что платим мы (домен, сервер, хранилище). Плашка наверху любого экрана появляется за 14 дней до срока
     (за 3, если сервис продлевается сам) и краснеет, когда срок вышел. Данные только у owner и tech. */
  let services = [];
  const loadServices = async () => { if (!canMoney) return; const r = await api.get('/api/admin/services'); if (r.ok) services = r.data.services; else fail(r); };
  const isoDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const toIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const daysTo = sv => (sv.until ? Math.round((isoDate(sv.until) - today) / 864e5) : null);
  const WARN_DAYS = 14, WARN_AUTO = 3;
  const svcLevel = sv => {
    const n = daysTo(sv);
    if (n == null) return 'none';
    if (n < 0) return 'bad';
    return n <= (sv.autoRenew ? WARN_AUTO : WARN_DAYS) ? 'warn' : 'ok';
  };
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const leftText = n => (n < 0 ? 'срок вышел ' + agoText(-n) : n === 0 ? 'последний день' : 'осталось ' + dayWord(n));
  const perMonth = () => Math.round(services.reduce((a, x) => a + (x.period === 'year' ? x.sum / 12 : x.sum), 0));
  const PAYER = { nika: 'Ника', karolina: 'Каролина' };
  /* Прибавить месяц или год, не перескакивая через конец месяца (31 января + месяц = 28 февраля) */
  const addPeriod = (d, period) => {
    const x = new Date(d.getFullYear(), d.getMonth() + (period === 'year' ? 12 : 1), 1);
    x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x;
  };

  const drawSvcAlert = () => {
    const box = $('[data-svc-alert]'); if (!box) return;
    const due = canMoney && routeName !== 'services' ? services.filter(x => ['warn', 'bad'].includes(svcLevel(x))).sort((a, b) => daysTo(a) - daysTo(b)) : [];
    box.hidden = !due.length; if (!due.length) return;
    const first = due[0], n = daysTo(first), bad = n < 0, urgent = n <= 3;
    box.className = 'svc-alert ' + (urgent ? 'svc-alert--bad' : 'svc-alert--warn');
    $('[data-svc-alert-t]').textContent = (bad ? 'Просрочено: ' : 'Скоро платить: ') + first.name;
    const rest = due.length > 1 ? ' · ещё ' + (due.length - 1) : '';
    $('[data-svc-alert-s]').textContent = cap(leftText(n)) + ' · ' + money(first.sum) + (first.period === 'year' ? ' / год' : ' / мес.') + rest;
  };

  /* Событие в календаре Ники за 3 дня до срока: письма с сайта пока ходить не могут, календарь страхует */
  const icsEsc = t => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const calendarFile = sv => {
    let d = addDays(isoDate(sv.until), -3); if (d < today) d = new Date(today);
    const next = addDays(d, 1), ymd = x => toIso(x).replace(/-/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nikassd.ru//admin//RU', 'BEGIN:VEVENT',
      'UID:svc-' + sv.id + '-' + sv.until + '@nikassd.ru', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''),
      'DTSTART;VALUE=DATE:' + ymd(d), 'DTEND;VALUE=DATE:' + ymd(next),
      'SUMMARY:' + icsEsc('Оплатить: ' + sv.name),
      'DESCRIPTION:' + icsEsc('Хватит до ' + fmt(isoDate(sv.until)) + '. ' + money(sv.sum) + (sv.period === 'year' ? ' в год' : ' в месяц') + (sv.payUrl ? '. Оплата: ' + sv.payUrl : '')),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc('Оплатить: ' + sv.name), 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
    const a = el('a'); a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'oplata-' + sv.id + '.ics'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const fact = (dt, dd) => { const w = el('div'); w.appendChild(el('dt', '', dt)); w.appendChild(el('dd', '', dd)); return w; };
  const drawServices = () => {
    const ul = $('[data-svc-list]'); ul.textContent = '';
    services.forEach(sv => {
      const lv = svcLevel(sv), n = daysTo(sv), li = el('li', 'svc svc--' + lv);
      const top = el('div', 'svc__top');
      top.appendChild(el('h2', 'svc__n', sv.name));
      top.appendChild(el('span', 'stat ' + (lv === 'none' ? 'stat--off' : 'stat--' + lv), lv === 'none' ? 'срок не задан' : lv === 'bad' ? 'просрочено' : lv === 'warn' ? 'скоро платить' : 'всё оплачено'));
      li.appendChild(top);
      if (sv.what) li.appendChild(el('p', 'svc__w', sv.what));
      const dl = el('dl', 'svc__f');
      dl.appendChild(fact('Сумма', money(sv.sum) + (sv.period === 'year' ? ' / год' : ' / мес.')));
      dl.appendChild(fact('Хватит до', sv.until ? fmt(isoDate(sv.until)) + (isoDate(sv.until).getFullYear() !== today.getFullYear() ? ' ' + isoDate(sv.until).getFullYear() : '') : 'не задано'));
      dl.appendChild(fact('Платит', PAYER[sv.payer]));
      dl.appendChild(fact('Продление', sv.autoRenew ? 'само' : 'руками'));
      li.appendChild(dl);
      if (n != null) li.appendChild(el('p', 'svc__left', leftText(n)));
      if (sv.note) li.appendChild(el('p', 'svc__note', sv.note));
      const act = el('div', 'svc__act');
      const paid = el('button', 'btn ' + (lv === 'warn' || lv === 'bad' ? 'btn--red' : 'btn--line-dark'), 'оплатила'); paid.type = 'button'; paid.addEventListener('click', () => svcPaidOpen(sv)); act.appendChild(paid);
      if (sv.payUrl && /^https:\/\//.test(sv.payUrl)) { const a = el('a', 'btn btn--line-dark', 'страница оплаты'); a.href = sv.payUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; act.appendChild(a); }
      if (sv.until) { const c = el('button', 'btn btn--line-dark', 'в календарь'); c.type = 'button'; c.addEventListener('click', () => { calendarFile(sv); toast('Файл скачан: открой его, и напоминание появится в календаре'); }); act.appendChild(c); }
      const ed = el('button', 'linkbtn', 'изменить'); ed.type = 'button'; ed.addEventListener('click', () => svcEdit(sv)); act.appendChild(ed);
      li.appendChild(act); ul.appendChild(li);
    });
    $('[data-svc-sum]').textContent = services.length ? 'Всего около ' + money(perMonth()) + ' в месяц' : '';
    if (!services.length) ul.appendChild(el('li', 'empty-line', 'Сервисов пока нет. Добавь первый: домен, сервер или хранилище.'));
  };

  /* Добавить или изменить */
  let svcCur = null;
  const fs = $('[data-form="svc"]'), fsErr = $('[data-ds-err]');
  const svcEdit = sv => {
    svcCur = sv || null; fsErr.textContent = ''; fs.reset();
    $('[data-ds-title]').textContent = sv ? 'Изменить сервис' : 'Новый сервис';
    $('[data-ds-del]').hidden = !sv;
    if (sv) { const f = fs.elements; f.name.value = sv.name; f.what.value = sv.what; f.sum.value = sv.sum; f.period.value = sv.period; f.until.value = sv.until || ''; f.payer.value = sv.payer; f.payUrl.value = sv.payUrl; f.note.value = sv.note; f.autoRenew.checked = sv.autoRenew; }
    openDlg('svc');
  };
  $('[data-svc-add]').addEventListener('click', () => svcEdit(null));
  fs.addEventListener('submit', async e => {
    e.preventDefault(); const f = fs.elements;
    const name = f.name.value.trim(), sumRaw = f.sum.value.trim(), url = f.payUrl.value.trim();
    [...fs.querySelectorAll('[aria-invalid]')].forEach(x => x.removeAttribute('aria-invalid'));
    const stop = (field, msg) => { fsErr.textContent = msg; field.setAttribute('aria-invalid', 'true'); field.focus(); };
    if (!name) return stop(f.name, 'Напиши название сервиса.');
    if (sumRaw && !/^\d{1,7}$/.test(sumRaw.replace(/\s/g, ''))) return stop(f.sum, 'Сумма: только цифры, в рублях.');
    if (url && !/^https:\/\//i.test(url)) return stop(f.payUrl, 'Ссылка должна начинаться с https://');
    const body = { name, what: f.what.value.trim(), sum: num(sumRaw), period: f.period.value, until: f.until.value, payer: f.payer.value, payUrl: url, note: f.note.value.trim(), autoRenew: f.autoRenew.checked };
    const btn = fs.querySelector('[type="submit"]'); btn.disabled = true;
    const r = svcCur ? await api.request('PATCH', '/api/admin/services/' + svcCur.id, body) : await api.post('/api/admin/services', body);
    btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); fsErr.textContent = r.data.error; return; }
    dlg('svc').close(); await loadServices(); drawServices(); drawSvcAlert(); toast(svcCur ? 'Сохранено' : 'Сервис добавлен');
  });
  $('[data-ds-del]').addEventListener('click', () => {
    const sv = svcCur; if (!sv) return;
    dlg('svc').close();
    confirmDlg('Удалить сервис?', '«' + sv.name + '» пропадёт из списка, напоминаний по нему больше не будет. Это не отключает сам сервис: подписку надо отменять у поставщика.', 'удалить', async () => {
      const r = await api.del('/api/admin/services/' + sv.id);
      if (!r.ok) { if (r.status === 401) return fail(r); toast(r.data.error); return; }
      await loadServices(); drawServices(); drawSvcAlert(); toast('Сервис удалён');
    });
  });

  /* «Оплатила»: подставляем следующую дату, её можно поправить */
  const fp = $('[data-form="svcpaid"]'), fpErr = $('[data-dsp-err]');
  let paidFor = null;
  const svcPaidOpen = sv => {
    paidFor = sv; fpErr.textContent = '';
    const base = sv.until && isoDate(sv.until) >= today ? isoDate(sv.until) : new Date(today);
    fp.elements.until.value = toIso(addPeriod(base, sv.period));
    $('[data-dsp-text]').textContent = sv.name + ': ' + money(sv.sum) + (sv.period === 'year' ? ' в год' : ' в месяц') + '. Платит ' + PAYER[sv.payer] + '. Отметь, когда деньги ушли.';
    $('[data-dsp-hint]').textContent = /timeweb/i.test(sv.name) ? 'Timeweb: поставь дату, до которой хватит баланса, она видна в панели.' : 'Дату можно поправить.';
    openDlg('svcpaid');
  };
  fp.addEventListener('submit', async e => {
    e.preventDefault(); const v = fp.elements.until.value;
    if (!v) { fpErr.textContent = 'Выбери дату.'; fp.elements.until.focus(); return; }
    const btn = fp.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await api.request('PATCH', '/api/admin/services/' + paidFor.id, { until: v }); btn.disabled = false;
    if (!r.ok) { if (r.status === 401) return fail(r); fpErr.textContent = r.data.error; return; }
    dlg('svcpaid').close(); await loadServices(); drawServices(); drawSvcAlert(); toast('Записано: хватит до ' + fmt(isoDate(v)));
  });

  /* ---------- Журнал, выход, сброс демо ---------- */
  const drawLog = () => {
    const ul = $('[data-log]'); ul.textContent = '';
    logList.forEach(x => ul.appendChild(histItem({ text: logText(x) + (x.client ? ' · ' + x.client : ''), note: x.note, when: when(x.at), who: x.who }, true)));
    if (!logList.length) ul.appendChild(el('li', 'hist__e', 'Пока ничего не менялось.'));
  };
  $$('[data-logout]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); window.NikaApi.logout('admin'); }));

  /* ---------- Роутер ---------- */
  const views = $$('[data-view]');
  const NAV = { today: 'today', clients: 'clients', client: 'clients', content: 'content', video: 'content', material: 'content', leads: 'leads', more: 'more', prices: 'more', services: 'more', log: 'more', payments: 'more' };
  const TITLES = { today: 'Сегодня', clients: 'Клиенты', client: 'Клиент', content: 'Контент', video: 'Видео', material: 'Материал', leads: 'Заявки', more: 'Ещё', prices: 'Тарифы и цены', services: 'Сервисы и оплаты', log: 'Журнал', payments: 'Оплаты' };
  let firstRun = true, routeName = '';
  const DRAW = { today: drawToday, clients: drawClients, leads: drawLeads, prices: drawPrices, services: drawServices, log: drawLog, payments: drawOrders };
  const FRESH = { today: () => Promise.all([loadClients(), loadPurchases(), loadLeads(), loadServices()]), clients: loadClients, prices: loadPrices, services: loadServices, log: loadLog, payments: loadOrders, leads: loadLeads };
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
      if (tab === 'videos') { drawVideos(); loadContent().then(ok => { if (ok && routeName === 'content' && !$('[data-pane="videos"]').hidden) drawVideos(); }); } else { drawMaterials(); loadMaterials().then(ok => { if (ok && routeName === 'content' && !$('[data-pane="materials"]').hidden) drawMaterials(); }); }
    }
    if ((name === 'prices' || name === 'services' || name === 'log' || name === 'payments') && !canMoney) { location.replace('#/more'); return; }
    routeName = name;
    (DRAW[name] || (() => {}))();
    /* Сначала рисуем то, что уже загружено, потом тихо обновляем с сервера */
    drawSvcAlert();
    if (FRESH[name]) FRESH[name]().then(() => { if (routeName === name) DRAW[name](); drawSvcAlert(); });
    updateDot();
    views.forEach(v => { v.hidden = v.dataset.view !== name; });
    $$('[data-nav]').forEach(a => { if (a.dataset.nav === NAV[name]) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = TITLES[name] + ' — админка Ники';
    window.scrollTo(0, 0);
    if (!firstRun) { const h = $('[data-view="' + name + '"] h1'); if (h) h.focus({ preventScroll: true }); }
    firstRun = false;
  };
  window.addEventListener('hashchange', route);
  await Promise.all([loadClients(), loadPurchases(), loadAccessTariffs(), loadPrices(), loadServices(), loadContent(), loadLeads(), loadSettings()]);
  route();
  /* Экскурсия один раз на админа (отметка на сервере). Кто прошёл её до переноса отметки на сервер,
     у того она есть в браузере: переносим молча и не показываем снова. */
  if (!who.tourDone) { if (rd(TOUR_KEY)) api.put('/api/admin/tour', { done: true }); else tourStart(); }
  else wr(TOUR_KEY, '1');
}
})();
