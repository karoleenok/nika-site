/* Кнопки покупки: [data-buy="id"]. Подключается на главной, на страницах материалов и в оформлении.

   КАК ПЕРЕКЛЮЧАЕТСЯ ОПЛАТА (без правок кода):
   GitHub → Settings → Secrets and variables → Actions → Variables → PAY_ONLINE.
   Не задана или 0  → по кнопке «купить» открывается окно: «оплата на сайте пока недоступна,
                      напиши Нике в WhatsApp» с готовым сообщением под конкретный товар.
   1                → кнопка ведёт в checkout.html и дальше в Robokassa, окна нет.
   После смены переменной запустить выкладку (Actions → Выкладка → Run workflow).

   Сервер сам отвечает на /api/pay/config. Если ответа нет (сервер лежит, GitHub Pages),
   показываем окно WhatsApp: так заявка точно не потеряется. */
(() => {
  'use strict';
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const phone = (document.body.dataset.waPhone || '').replace(/\D/g, '');
  const base = document.currentScript ? new URL('../', document.currentScript.src) : new URL('./', location.href);
  const C = window.NDCatalog || {};
  const has = id => Object.prototype.hasOwnProperty.call(C, id);
  const nb = s => String(s).replace(/ (₽|за)\b/g, ' $1');

  /* ---------- Включена ли оплата на сайте ---------- */
  let online = null;   // null — ещё не знаем
  const ready = (async () => {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(new URL('api/pay/config', base), { credentials: 'same-origin', cache: 'no-store', signal: ctl.signal });
      clearTimeout(timer);
      online = r.ok && (await r.json()).online === true;
    } catch (_) { online = false; }
    return online;
  })();

  /* ---------- Текст для WhatsApp под товар ---------- */
  const rub = n => n.toLocaleString('ru-RU').replace(/\s/g, ' ') + ' ₽';
  const nameOf = (id, btn) => {
    if (has(id)) return C[id].title;
    const card = btn && btn.closest('.product');
    const t = card && card.querySelector('.product__title');
    const h1 = document.querySelector('h1');
    return ((t && t.textContent) || (h1 && h1.textContent) || '').replace(/\s+/g, ' ').trim();
  };
  const waText = (id, name) => {
    const it = has(id) ? C[id] : null;
    const price = it ? ' (' + rub(it.price) + (it.per ? ' ' + it.per : '') + ')' : '';
    const ask = it && it.after === 'contact'
      ? 'Подскажите, как оплатить и на какую дату есть ближайшая запись?'
      : 'Подскажите, как оплатить?';
    return 'Здравствуйте, Ника! Хочу купить на сайте «' + name + '»' + price + ', но оплата на сайте пока не работает. ' + ask;
  };
  const waUrl = text => 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);

  /* ---------- Окно ---------- */
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = new URL('css/pay-offline.css?v=20261114b', base).href;
  document.head.appendChild(css);

  const WA_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z"/></svg>';

  let dlg = null, lastFocus = null;
  const build = () => {
    dlg = document.createElement('dialog');
    dlg.className = 'po';
    dlg.setAttribute('aria-labelledby', 'po-title');
    dlg.innerHTML =
      '<div class="po__back" data-po-close></div>' +
      '<div class="po__panel">' +
        '<div class="po__grip" aria-hidden="true"></div>' +
        '<div class="po__head"><span class="po__label">оплата на сайте временно недоступна</span>' +
          '<button class="po__x" type="button" data-po-close aria-label="Закрыть"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>' +
        '<h2 class="po__title" id="po-title" tabindex="-1">Купить можно через&nbsp;Нику</h2>' +
        '<p class="po__text">Напиши Нике в&nbsp;WhatsApp: она пришлёт, как оплатить, и&nbsp;сама откроет доступ или договорится о&nbsp;дате. Обычно отвечает в&nbsp;течение дня.</p>' +
        '<div class="po__item" data-po-item hidden><p class="po__kind" data-po-kind></p><p class="po__name" data-po-name></p><p class="po__price" data-po-price></p></div>' +
        '<div class="po__acts">' +
          '<a class="btn btn--red" data-po-wa target="_blank" rel="noopener noreferrer">' + WA_ICON + '<span>написать Нике в WhatsApp</span></a>' +
          '<button class="btn po__later" type="button" data-po-close>вернуться на сайт</button>' +
        '</div>' +
        '<p class="po__fine">Откроется WhatsApp с готовым сообщением про этот товар. Ты увидишь текст до отправки.</p>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target.closest('[data-po-close]')) close(); });
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });   // Esc
    dlg.querySelector('[data-po-wa]').addEventListener('click', () => setTimeout(close, 300));
  };

  function close() {
    if (!dlg || !dlg.open) return;
    dlg.classList.remove('is-open');
    const done = () => { dlg.close(); document.documentElement.classList.remove('po-lock'); if (lastFocus) lastFocus.focus({ preventScroll: true }); };
    matchMedia('(prefers-reduced-motion: reduce)').matches ? done() : setTimeout(done, 300);
  }

  function offer(id, btn) {
    if (!dlg) build();
    lastFocus = btn || document.activeElement;
    const name = nameOf(id, btn);
    const it = has(id) ? C[id] : null;
    const box = dlg.querySelector('[data-po-item]');
    box.hidden = !name;
    dlg.querySelector('[data-po-kind]').textContent = it ? it.kind : '';
    dlg.querySelector('[data-po-name]').textContent = name;
    const pr = dlg.querySelector('[data-po-price]');
    pr.textContent = it ? nb(rub(it.price) + (it.per ? ' ' + it.per : '')) : '';
    if (it && it.old) { const s = document.createElement('s'); s.textContent = rub(it.old); pr.appendChild(s); }
    pr.hidden = !it;
    const wa = dlg.querySelector('[data-po-wa]');
    wa.href = phone ? waUrl(waText(id, name)) : 'https://wa.me/';
    document.documentElement.classList.add('po-lock');
    dlg.showModal();
    requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add('is-open')));
    dlg.querySelector('#po-title').focus({ preventScroll: true });
  }

  /* ---------- Кнопки ---------- */
  $$('[data-buy]').forEach(a => {
    a.href = new URL('checkout.html', base).pathname + '?item=' + encodeURIComponent(a.dataset.buy);
    a.removeAttribute('target'); a.removeAttribute('rel');
    a.addEventListener('click', async e => {
      if (online === true) return;          // оплата включена: обычный переход в оформление
      e.preventDefault();
      if (online === null && (await ready)) { location.assign(a.href); return; }
      offer(a.dataset.buy, a);
    });
  });

  window.NDPay = { ready, offer, isOnline: () => online === true };
})();
