/* Оформление заказа: товар из каталога, почта и согласия, окно оплаты (заглушка).
   Товар берётся только из js/catalog.js по ?item=id. Цену из адреса не читаем: её нельзя подменить ссылкой. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const C = window.NDCatalog || {}, PAY = (window.NDPay && window.NDPay.url) || {};
  const id = new URLSearchParams(location.search).get('item');
  const it = Object.prototype.hasOwnProperty.call(C, id) ? C[id] : null;
  const root = $('[data-co]');
  if (!it) { $('[data-co-empty]').hidden = false; return; }

  const rub = n => n.toLocaleString('ru-RU').replace(/\s/g, ' ') + ' ₽';
  root.hidden = false;
  $('[data-co-kind]').textContent = it.kind;
  $('[data-co-title]').textContent = it.title;
  if (it.note) { const n = $('[data-co-note]'); n.textContent = it.note; n.hidden = false; }
  $('[data-co-price]').textContent = rub(it.price);
  $('[data-co-price2]').textContent = rub(it.price);
  if (it.old) { const o = $('[data-co-old]'); o.textContent = rub(it.old); o.hidden = false; }
  if (it.per) { const p = $('[data-co-per]'); p.textContent = it.per.replace(/ /g, ' '); p.hidden = false; }
  if (it.after === 'contact') $('[data-co-hint]').textContent = 'На эту почту придёт чек. Ника напишет тебе в мессенджере или по почте, чтобы договориться о дате.';
  $('[data-co-back]').href = it.page || 'index.html#shop';
  document.title = 'Оформление: ' + it.title + ' — Ника Дупина';

  const form = $('[data-co-form]'), pay = $('[data-co-pay]'), msg = $('[data-co-msg]');
  const KEY = 'nd_order';
  const save = o => { try { sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (_) {} };
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

  const show = step => {
    const order = load();
    if (step === 'pay' && !(order && order.id === id)) step = 'form';
    form.hidden = step === 'pay';
    pay.hidden = step !== 'pay';
    if (step === 'pay') { $('[data-co-email]').textContent = order.email; $('#co-pay-t').focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  form.addEventListener('submit', e => {
    e.preventDefault();
    const em = form.elements.email, ok = form.elements.consent, ag = form.elements.agree;
    [em, ok, ag].forEach(i => i.removeAttribute('aria-invalid'));
    msg.textContent = '';
    if (!emailOk(em.value.trim())) { em.setAttribute('aria-invalid', 'true'); msg.textContent = 'Проверь почту: так мы пришлём чек.'; em.focus(); return; }
    if (!ok.checked || !ag.checked) {
      [ok, ag].forEach(i => { if (!i.checked) i.setAttribute('aria-invalid', 'true'); });
      msg.textContent = 'Поставь обе галочки: согласие на обработку данных и ознакомление с документами.';
      (ok.checked ? ag : ok).focus(); return;
    }
    save({ id, email: em.value.trim(), ts: Date.now() });
    if (PAY[id]) { location.assign(PAY[id]); return; }           // боевой режим: уходим на страницу платёжки
    history.pushState(null, '', '#pay'); show('pay');             // пока заглушка
  });

  $('[data-co-edit]').addEventListener('click', () => { history.replaceState(null, '', location.pathname + location.search); show('form'); });
  window.addEventListener('popstate', () => show(location.hash === '#pay' ? 'pay' : 'form'));

  $('[data-co-fake]').addEventListener('click', () => {
    const order = load(); if (!order) { show('form'); return; }
    location.assign('spasibo.html?t=pay&item=' + encodeURIComponent(id));
  });

  const o = load(); if (o && o.id === id) form.elements.email.value = o.email;
  if (location.hash === '#pay') show('pay');
})();
