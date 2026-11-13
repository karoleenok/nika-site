/* Оформление заказа: товар из каталога, почта и согласия, переход на оплату в Robokassa.
   Товар берётся из js/catalog.js по ?item=id только для показа. Цену на оплату ставит сервер по артикулу,
   поэтому подмена цены в браузере ничего не даст. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const C = window.NDCatalog || {};
  const id = new URLSearchParams(location.search).get('item');
  const it = Object.prototype.hasOwnProperty.call(C, id) ? C[id] : null;
  const root = $('[data-co]');
  if (!it) { $('[data-co-empty]').hidden = false; return; }

  const rub = n => n.toLocaleString('ru-RU').replace(/\s/g, ' ') + ' ₽';
  root.hidden = false;
  $('[data-co-kind]').textContent = it.kind;
  $('[data-co-title]').textContent = it.title;
  if (it.note) { const n = $('[data-co-note]'); n.textContent = it.note; n.hidden = false; }
  $('[data-co-price]').textContent = rub(it.price);
  if (it.old) { const o = $('[data-co-old]'); o.textContent = rub(it.old); o.hidden = false; }
  if (it.per) { const p = $('[data-co-per]'); p.textContent = it.per.replace(/ /g, ' '); p.hidden = false; }
  if (it.after === 'contact') $('[data-co-hint]').textContent = 'На эту почту придёт чек. Ника напишет тебе в мессенджере или по почте, чтобы договориться о дате.';
  $('[data-co-back]').href = it.page || 'index.html#shop';
  document.title = 'Оформление: ' + it.title + ' — Ника Дупина';

  const form = $('[data-co-form]'), msg = $('[data-co-msg]'), go = $('[data-co-go]');
  const goText = go.innerHTML;
  const KEY = 'nd_order';
  const save = o => { try { sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (_) {} };
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const busy = on => { go.disabled = on; go.setAttribute('aria-busy', String(on)); go.innerHTML = on ? 'открываем оплату…' : goText; };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (go.disabled) return;
    const em = form.elements.email, ok = form.elements.consent, ag = form.elements.agree;
    [em, ok, ag].forEach(i => i.removeAttribute('aria-invalid'));
    msg.textContent = '';
    const email = em.value.trim();
    if (!emailOk(email)) { em.setAttribute('aria-invalid', 'true'); msg.textContent = 'Проверь почту: так мы пришлём чек.'; em.focus(); return; }
    if (!ok.checked || !ag.checked) {
      [ok, ag].forEach(i => { if (!i.checked) i.setAttribute('aria-invalid', 'true'); });
      msg.textContent = 'Поставь обе галочки: согласие на обработку данных и ознакомление с документами.';
      (ok.checked ? ag : ok).focus(); return;
    }
    busy(true);
    const r = await window.NikaApi.post('/api/pay/start', { item: id, email, consent: true, agree: true });
    if (!r.ok) {
      busy(false);
      msg.textContent = r.data.error;
      return;
    }
    save({ id, email, orderId: r.data.orderId, key: r.data.key, ts: Date.now() });
    location.assign(r.data.url);   // страница оплаты Robokassa: карта или СБП
  });

  // Кнопка «назад» из Robokassa возвращает страницу из кэша с заблокированной кнопкой
  window.addEventListener('pageshow', () => busy(false));
  const o = load(); if (o && o.id === id) form.elements.email.value = o.email;
})();
