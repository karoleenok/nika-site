/* Вход: почта → код из письма (или ссылка из письма, или пароль, если клиент его задал).
   Проверку кода, ссылки, пароля, лимиты и сроки делает сервер. body[data-kind="admin"] — вход в админку. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const API = window.NikaApi;
  const KIND = document.body.dataset.kind === 'admin' ? 'admin' : 'user';
  const GO = document.body.dataset.redirect || 'index.html';
  const DAYS = Number(document.body.dataset.sessionDays) || 30;

  const phone = (document.body.dataset.waPhone || '').replace(/\D/g, '');
  const wa = $('[data-wa]');
  if (wa && phone) { wa.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(wa.dataset.wa); wa.target = '_blank'; wa.rel = 'noopener noreferrer'; }
  document.querySelectorAll('[data-days]').forEach(n => { n.textContent = String(DAYS); });

  const steps = { email: $('[data-step="email"]'), code: $('[data-step="code"]'), password: $('[data-step="password"]'), link: $('[data-step="link"]') };
  const show = name => Object.keys(steps).forEach(k => { if (steps[k]) steps[k].hidden = k !== name; });
  const email = $('[data-email]'), code = $('[data-code]'), pass = $('[data-pass]');
  const sentTo = $('[data-sent-to]'), resend = $('[data-resend]');
  const errEmail = $('[data-err="email"]'), errCode = $('[data-err="code"]'), errPass = $('[data-err="pass"]'), errLink = $('[data-err="link"]');
  let timer = 0, linkToken = '';

  /* Ссылка из письма: токен сразу убираем из адресной строки и истории, держим только в памяти */
  const urlToken = new URLSearchParams(location.search).get('t');
  if (urlToken !== null) history.replaceState(null, '', location.pathname);

  /* Уже вошёл — сразу в кабинет */
  if (urlToken === null) API.get(KIND === 'admin' ? '/api/admin/me' : '/api/me').then(r => { if (r.ok) location.replace(GO); });

  const setErr = (input, box, msg) => {
    if (!box) return;
    box.textContent = msg || '';
    if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  };
  const busy = (form, on) => { const b = form && form.querySelector('[type="submit"]'); if (b) { b.disabled = on; b.setAttribute('aria-busy', String(on)); } };
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

  /* Запросить письмо с кодом и ссылкой. Ответ сервера одинаковый, есть почта в базе или нет. */
  const sendCode = async (v, form) => {
    busy(form, true);
    const r = await API.post('/api/auth/code', { email: v, kind: KIND });
    busy(form, false);
    if (!r.ok) {
      show('email');
      setErr(email, errEmail, r.data.error);
      return false;
    }
    sentTo.textContent = v;
    show('code');
    setErr(code, errCode, '');
    code.value = '';
    startTimer(); code.focus();
    return true;
  };

  steps.email.addEventListener('submit', e => { e.preventDefault(); setErr(null, errLink, ''); const v = takeEmail(); if (v) sendCode(v, steps.email); });

  resend.addEventListener('click', async () => {
    if (resend.disabled) return;
    const r = await API.post('/api/auth/code', { email: sentTo.textContent, kind: KIND });
    if (r.ok) { startTimer(); setErr(code, errCode, ''); } else setErr(code, errCode, r.data.error);
    code.focus();
  });
  $('[data-change]').addEventListener('click', () => {
    clearInterval(timer);
    setErr(code, errCode, ''); show('email'); email.focus();
  });

  code.addEventListener('input', () => {
    code.value = code.value.replace(/\D/g, '').slice(0, 6);
    if (code.value.length) setErr(code, errCode, '');
    if (code.value.length === 6) (steps.code.requestSubmit ? steps.code.requestSubmit() : steps.code.dispatchEvent(new Event('submit', { cancelable: true })));
  });

  let checking = false;
  steps.code.addEventListener('submit', async e => {
    e.preventDefault();
    if (checking) return;
    if (code.value.length !== 6) { setErr(code, errCode, 'Введи шесть цифр из письма.'); code.focus(); return; }
    checking = true; busy(steps.code, true);
    const r = await API.post('/api/auth/verify', { email: sentTo.textContent, code: code.value, kind: KIND, remember: $('[data-remember]').checked });
    checking = false; busy(steps.code, false);
    if (r.ok) { location.replace(GO); return; }
    setErr(code, errCode, r.data.error);
    code.select();
  });

  /* ---------- Вход по паролю (необязательный, задаётся в профиле кабинета) ---------- */
  if (steps.password) {
    $('[data-to-pass]').addEventListener('click', () => {
      const v = takeEmail(); if (!v) return;
      $('[data-pass-to]').textContent = v; pass.value = ''; setErr(pass, errPass, '');
      show('password'); pass.focus();
    });
    $('[data-to-code]').addEventListener('click', () => { const v = email.value.trim(); if (validEmail(v)) sendCode(v); else { show('email'); email.focus(); } });
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
      if (!pass.value) { setErr(pass, errPass, 'Введи пароль.'); pass.focus(); return; }
      busy(steps.password, true);
      const r = await API.post('/api/auth/password', { email: email.value.trim(), password: pass.value, remember: $('[data-remember-pass]').checked });
      busy(steps.password, false);
      if (r.ok) { location.replace(GO); return; }
      setErr(pass, errPass, r.data.error);
      pass.select();
    });
  }

  /* ---------- Ссылка из письма: login.html?t=<одноразовый токен> ----------
     Открытие ссылки ничего не тратит (антивирусы почтовиков открывают ссылки сами).
     Вход только по кнопке «войти в кабинет» — POST-запросом. */
  if (steps.link && urlToken !== null) {
    linkToken = urlToken;
    show('none');
    const linkBad = msg => { linkToken = ''; show('email'); setErr(null, errLink, msg || 'Ссылка устарела или уже использована. Получи новый код.'); };
    API.post('/api/auth/link', { t: linkToken, check: true }).then(r => { if (r.ok) { show('link'); steps.link.querySelector('[type="submit"]').focus(); } else linkBad(r.data.error); });
    steps.link.addEventListener('submit', async e => {
      e.preventDefault();
      busy(steps.link, true);
      const r = await API.post('/api/auth/link', { t: linkToken, remember: $('[data-remember-link]').checked });
      busy(steps.link, false);
      if (r.ok) { linkToken = ''; location.replace(GO); return; }
      linkBad(r.data.error);
    });
  }
})();
