/* Вход в кабинет: почта → код из письма. ДЕМО: настоящую отправку и проверку кода делает сервер.
   Здесь только поведение формы. Лимит попыток и срок жизни кода обязаны быть на сервере. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const KEY = 'nika_lk_session';
  const store = (k, v) => { try { return v === undefined ? (localStorage.getItem(k) || sessionStorage.getItem(k)) : (v ? localStorage : sessionStorage).setItem(k, '1'); } catch (_) { return null; } };

  if (store(KEY)) { location.replace('index.html'); return; }

  const demo = !!(window.LK_DATA && window.LK_DATA.demo);
  const phone = (document.body.dataset.waPhone || '').replace(/\D/g, '');
  const wa = $('[data-wa]');
  if (wa && phone) { wa.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(wa.dataset.wa); wa.target = '_blank'; wa.rel = 'noopener noreferrer'; }

  const stepEmail = $('[data-step="email"]');
  const stepCode  = $('[data-step="code"]');
  const email = $('[data-email]');
  const code  = $('[data-code]');
  const sentTo = $('[data-sent-to]');
  const resend = $('[data-resend]');
  const errEmail = $('[data-err="email"]');
  const errCode  = $('[data-err="code"]');
  let attempts = 0, lockedUntil = 0, timer = 0;

  const setErr = (input, box, msg) => {
    box.textContent = msg || '';
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  };

  const startTimer = () => {
    let left = 60;
    clearInterval(timer);
    resend.disabled = true;
    const tick = () => {
      if (left <= 0) { clearInterval(timer); resend.disabled = false; resend.textContent = 'отправить ещё раз'; return; }
      resend.textContent = 'отправить ещё раз через ' + left + ' с';
      left -= 1;
    };
    tick(); timer = setInterval(tick, 1000);
  };

  stepEmail.addEventListener('submit', e => {
    e.preventDefault();
    const v = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
      setErr(email, errEmail, 'Проверь почту: похоже, в адресе опечатка.');
      email.focus(); return;
    }
    setErr(email, errEmail, '');
    sentTo.textContent = v;
    stepEmail.hidden = true; stepCode.hidden = false;
    $('[data-demo-hint]').hidden = !demo;
    code.value = ''; attempts = 0;
    startTimer(); code.focus();
  });

  resend.addEventListener('click', () => { if (!resend.disabled) { startTimer(); code.focus(); } });
  $('[data-change]').addEventListener('click', () => {
    clearInterval(timer);
    stepCode.hidden = true; stepEmail.hidden = false; setErr(code, errCode, ''); email.focus();
  });

  code.addEventListener('input', () => {
    code.value = code.value.replace(/\D/g, '').slice(0, 6);
    if (code.value.length) setErr(code, errCode, '');
    if (code.value.length === 6) (stepCode.requestSubmit ? stepCode.requestSubmit() : stepCode.dispatchEvent(new Event('submit', { cancelable: true })));
  });

  stepCode.addEventListener('submit', e => {
    e.preventDefault();
    const now = Date.now();
    if (now < lockedUntil) { setErr(code, errCode, 'Слишком много попыток. Подожди минуту и запроси новый код.'); return; }
    if (code.value.length !== 6) { setErr(code, errCode, 'Введи шесть цифр из письма.'); code.focus(); return; }
    if (code.value === '123456') {              // ДЕМО: настоящую проверку делает сервер
      store(KEY, $('[data-remember]').checked);
      location.replace('index.html');
      return;
    }
    attempts += 1;
    if (attempts >= 5) { lockedUntil = now + 60000; setErr(code, errCode, 'Слишком много попыток. Подожди минуту и запроси новый код.'); }
    else setErr(code, errCode, 'Неверный код. Осталось попыток: ' + (5 - attempts) + '.');
    code.select();
  });
})();
