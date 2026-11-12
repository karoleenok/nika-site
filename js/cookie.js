/* Баннер cookie. Без зависимостей.
   Выбор хранится в localStorage: 'all' (разрешены все) или 'necessary' (только необходимые).
   Сайт сейчас не ставит аналитику. Когда появится Метрика, подключать её нужно только после
   NDCookie.get() === 'all' или в обработчике NDCookie.onChange. */
(() => {
  'use strict';
  const KEY = 'nd_cookie';
  const root = document.documentElement;
  const listeners = [];
  const read = () => { try { const v = localStorage.getItem(KEY); return v === 'all' || v === 'necessary' ? v : null; } catch (_) { return null; } };
  const write = v => { try { localStorage.setItem(KEY, v); } catch (_) { /* приватный режим: спросим ещё раз при следующем заходе */ } };
  let box = null;

  const close = (value) => {
    write(value);
    listeners.forEach(fn => { try { fn(value); } catch (_) {} });
    if (!box) return;
    box.classList.add('is-out');
    root.classList.remove('has-ck');
    setTimeout(() => { box && box.remove(); box = null; }, 220);
  };

  const policyHref = () => (document.querySelector('script[src*="cookie.js"]').getAttribute('src').replace(/js\/cookie\.js.*$/, '') || '') + 'legal/privacy.html';

  const open = () => {
    if (box) return;
    box = document.createElement('div');
    box.className = 'ck';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Файлы cookie');
    box.innerHTML =
      '<p class="ck__t">Cookie</p>' +
      '<p class="ck__p">Сайт использует файлы cookie, чтобы работать корректно, и, если ты разрешишь, чтобы понимать, как им пользуются. ' +
      'Подробнее в <a href="' + policyHref() + '">Политике обработки персональных данных</a>.</p>' +
      '<div class="ck__btns">' +
      '<button type="button" class="ck__btn ck__btn--ok" data-ck="all">принять</button>' +
      '<button type="button" class="ck__btn ck__btn--no" data-ck="necessary">только необходимые</button>' +
      '</div>';
    box.addEventListener('click', e => { const b = e.target.closest('[data-ck]'); if (b) close(b.dataset.ck); });
    box.addEventListener('keydown', e => { if (e.key === 'Escape') close('necessary'); });
    document.body.appendChild(box);
    root.classList.add('has-ck');
  };

  window.NDCookie = { get: read, open, onChange: fn => listeners.push(fn) };
  const init = () => {
    document.addEventListener('click', e => { if (e.target.closest('[data-cookie-open]')) open(); });
    if (!read()) open();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
