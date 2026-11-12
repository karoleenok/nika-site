/* Кнопки покупки: [data-buy="id"]. Подключается на главной и на страницах материалов.

   РЕЖИМЫ (меняется одной строкой ниже):
   'checkout' — кнопка ведёт на checkout.html: заказ, почта, согласия, окно оплаты (сейчас заглушка).
   'whatsapp' — прежний запасной режим: кнопка открывает WhatsApp с названием товара.
   Он оставлен в коде нарочно: если платёжка подведёт, вернуть его можно одной строкой.

   PAY_URL — когда подключим платёжку: ссылка на оплату по id товара. Если для id она есть,
   checkout.html после согласий отправит человека туда, а заглушка не покажется. */
(() => {
  'use strict';
  const PAY_MODE = 'checkout';      // 'checkout' | 'whatsapp'
  const PAY_URL = {};               // например: 'train-1m': 'https://…'
  window.NDPay = { url: PAY_URL, mode: PAY_MODE };

  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const phone = (document.body.dataset.waPhone || '').replace(/\D/g, '');
  const base = document.currentScript ? new URL('../', document.currentScript.src) : new URL('./', location.href);
  const C = window.NDCatalog || {};

  $$('[data-buy]').forEach(a => {
    const id = a.dataset.buy;
    if (PAY_MODE === 'checkout') {
      a.href = new URL('checkout.html', base).pathname + '?item=' + encodeURIComponent(id);
      a.removeAttribute('target'); a.removeAttribute('rel');
      return;
    }
    /* ---- запасной режим: WhatsApp ---- */
    if (!phone) return;
    const it = C[id];
    const h1 = document.querySelector('h1');
    const card = a.closest('.product');
    const titleEl = card && card.querySelector('.product__title');
    const name = ((it && it.title) || (titleEl ? titleEl.textContent : '') || (h1 ? h1.textContent : '')).replace(/\s+/g, ' ').trim();
    const ask = /^(food-|package)/.test(id) ? 'Подскажите, на какую дату есть ближайшая запись?' : 'Подскажите, как оформить покупку?';
    a.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent('Здравствуйте! Пишу вам с сайта, меня интересует «' + name + '». ' + ask);
    a.target = '_blank'; a.rel = 'noopener noreferrer';
  });
})();
