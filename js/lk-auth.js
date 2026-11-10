/* Вход в кабинет: почта → код из письма (или ссылка из письма, или пароль, если клиент его задал).
   ДЕМО: настоящую отправку письма, проверку кода, ссылки и пароля делает сервер.
   Здесь только поведение формы. Лимит попыток, срок жизни кода и ссылки обязаны быть на сервере. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const KEY = document.body.dataset.sessionKey || 'nika_lk_session';
  const GO = document.body.dataset.redirect || 'index.html';
  const DAYS = Number(document.body.dataset.sessionDays) || 30;   // «запомнить меня»: сколько дней живёт сессия на устройстве
  const PW_KEY = 'nika_lk_pw';                                    // ДЕМО: SHA-256 пароля; на сервере — хеш argon2id/bcrypt
  const S = window.NikaSession;

  if (S.active(KEY)) { location.replace(GO); return; }

  const demo = !!(window.LK_DATA && window.LK_DATA.demo);
  const phone = (document.body.dataset.waPhone || '').replace(/\D/g, '');
  const wa = $('[data-wa]');
  if (wa && phone) { wa.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(wa.dataset.wa); wa.target = '_blank'; wa.rel = 'noopener noreferrer'; }
  document.querySelectorAll('[data-days]').forEach(n => { n.textContent = String(DAYS); });

  const steps = { email: $('[data-step="email"]'), code: $('[data-step="code"]'), password: $('[data-step="password"]'), link: $('[data-step="link"]') };
  const show = name => Object.keys(steps).forEach(k => { if (steps[k]) steps[k].hidden = k !== name; });
  const email = $('[data-email]'), code = $('[data-code]'), pass = $('[data-pass]');
  const sentTo = $('[data-sent-to]'), resend = $('[data-resend]');
  const errEmail = $('[data-err="email"]'), errCode = $('[data-err="code"]'), errPass = $('[data-err="pass"]'), errLink = $('[data-err="link"]');
  let attempts = 0, lockedUntil = 0, timer = 0;

  const setErr = (input, box, msg) => {
    if (!box) return;
    box.textContent = msg || '';
    if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  };
  const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const takeEmail = () => {
    const v = email.value.trim();
    if (!validEmail(v)) { setErr(email, errEmail, 'Проверь почту: похоже, в адресе опечатка.'); email.focus(); return ''; }
    setErr(email, errEmail, ''); return v;
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

  /* Отправить письмо с кодом и ссылкой и показать шаг ввода кода (ДЕМО: письмо не уходит) */
  const sendCode = v => {
    sentTo.textContent = v;
    show('code');
    $('[data-demo-hint]').hidden = !demo;
    code.value = ''; attempts = 0;
    startTimer(); code.focus();
  };

  steps.email.addEventListener('submit', e => { e.preventDefault(); const v = takeEmail(); if (v) sendCode(v); });

  resend.addEventListener('click', () => { if (!resend.disabled) { startTimer(); code.focus(); } });
  $('[data-change]').addEventListener('click', () => {
    clearInterval(timer);
    setErr(code, errCode, ''); show('email'); email.focus();
  });

  code.addEventListener('input', () => {
    code.value = code.value.replace(/\D/g, '').slice(0, 6);
    if (code.value.length) setErr(code, errCode, '');
    if (code.value.length === 6) (steps.code.requestSubmit ? steps.code.requestSubmit() : steps.code.dispatchEvent(new Event('submit', { cancelable: true })));
  });

  steps.code.addEventListener('submit', e => {
    e.preventDefault();
    const now = Date.now();
    if (now < lockedUntil) { setErr(code, errCode, 'Слишком много попыток. Подожди минуту и запроси новый код.'); return; }
    if (code.value.length !== 6) { setErr(code, errCode, 'Введи шесть цифр из письма.'); code.focus(); return; }
    if (code.value === '123456') {              // ДЕМО: настоящую проверку делает сервер
      S.start(KEY, DAYS, $('[data-remember]').checked);
      location.replace(GO);
      return;
    }
    attempts += 1;
    if (attempts >= 5) { lockedUntil = now + 60000; setErr(code, errCode, 'Слишком много попыток. Подожди минуту и запроси новый код.'); }
    else setErr(code, errCode, 'Неверный код. Осталось попыток: ' + (5 - attempts) + '.');
    code.select();
  });

  /* ---------- Вход по паролю (необязательный, задаётся в профиле кабинета) ---------- */
  if (steps.password) {
    const sha = async s => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    };
    let passAttempts = 0, passLock = 0;

    $('[data-to-pass]').addEventListener('click', () => {
      const v = takeEmail(); if (!v) return;
      $('[data-pass-to]').textContent = v; pass.value = ''; setErr(pass, errPass, '');
      show('password'); pass.focus();
    });
    $('[data-to-code]').addEventListener('click', () => { const v = takeEmail() || email.value.trim(); if (validEmail(v)) sendCode(v); else { show('email'); email.focus(); } });
    $('[data-forgot]').addEventListener('click', () => sendCode(email.value.trim()));

    const eye = $('[data-eye]');
    eye.addEventListener('click', () => {
      const on = pass.type === 'password';
      pass.type = on ? 'text' : 'password';
      eye.textContent = on ? 'скрыть' : 'показать';
      eye.setAttribute('aria-pressed', String(on));
      eye.setAttribute('aria-label', on ? 'Скрыть пароль' : 'Показать пароль');
    });

    steps.password.addEventListener('submit', async e => {
      e.preventDefault();
      const now = Date.now();
      if (now < passLock) { setErr(pass, errPass, 'Слишком много попыток. Подожди минуту или войди по коду.'); return; }
      if (!pass.value) { setErr(pass, errPass, 'Введи пароль.'); pass.focus(); return; }
      let ok = false;
      try { const saved = localStorage.getItem(PW_KEY); ok = !!saved && saved === await sha(pass.value); } catch (_) {}
      if (ok) { S.start(KEY, DAYS, $('[data-remember-pass]').checked); location.replace(GO); return; }
      passAttempts += 1;
      if (passAttempts >= 5) { passLock = now + 60000; setErr(pass, errPass, 'Слишком много попыток. Подожди минуту или войди по коду.'); }
      else setErr(pass, errPass, 'Неверная почта или пароль. Можно войти по коду.');   // одно и то же сообщение, чтобы не выдавать, есть ли такая почта
      pass.select();
    });
  }

  /* ---------- Ссылка из письма: login.html?t=<одноразовый токен> ---------- */
  if (steps.link) {
    const token = new URLSearchParams(location.search).get('t');
    if (token !== null) {
      history.replaceState(null, '', location.pathname);             // токен не должен остаться в адресной строке и истории
      show('none');
      if (demo && token === 'demo') {                                // ДЕМО: настоящий токен проверяет сервер
        show('link');
      } else {
        show('email');
        setErr(null, errLink, 'Ссылка устарела или уже использована. Получи новый код.');
      }
    }
    steps.link.addEventListener('submit', e => {
      e.preventDefault();
      S.start(KEY, DAYS, $('[data-remember-link]').checked);        // на сервере: POST с токеном, ответ с HttpOnly-кукой
      location.replace(GO);
    });
  }
})();
