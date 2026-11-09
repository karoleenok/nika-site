/* Лёгкий JS без зависимостей. Всё работает и без него (контент виден, ссылки ведут по якорям). */
(() => {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- Табы «тренировки / питание» ---------- */
  const tabs = $$('.tab');
  const panels = $$('.panel');
  function selectTab(id, { focus = false, push = true } = {}) {
    tabs.forEach(t => {
      const on = t.dataset.tab === id;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    panels.forEach(p => {
      const on = p.id === 'panel-' + id;
      p.hidden = !on;
      p.classList.toggle('is-active', on);
    });
    document.documentElement.dataset.tab = id;
    if (push) { try { history.replaceState(null, '', '#services'); } catch (_) {} }
    // новые блоки могли быть скрыты (reveal) — показываем сразу, чтобы не было пустоты после переключения
    $$('#panel-' + id + ' [data-reveal]').forEach(el => el.classList.add('is-in'));
  }
  tabs.forEach(t => t.addEventListener('click', () => selectTab(t.dataset.tab)));
  $('.tabs')?.addEventListener('keydown', e => {
    const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft')  n = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End')  n = tabs.length - 1;
    if (n > -1) { e.preventDefault(); selectTab(tabs[n].dataset.tab, { focus: true }); }
  });
  $$('[data-tab-link]').forEach(a => a.addEventListener('click', () => selectTab(a.dataset.tabLink)));

  /* «Пройти тест»: на вкладке «питание» тест лежит в панели, в финале он скрыт */
  $$('a[href="#test"]').forEach(a => a.addEventListener('click', e => {
    const food = document.documentElement.dataset.tab === 'food';
    const target = document.getElementById(food ? 'test-food' : 'test');
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }));


  /* ---------- Мобильное меню ---------- */
  const burger = $('.burger'), menu = $('#menu');
  const behind = $$('.hero, main, footer, .wa-fab');
  const isMenuOpen = () => !!menu && menu.classList.contains('is-open');
  function setMenu(open) {
    if (!burger || !menu) return;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    document.body.classList.toggle('menu-lock', open);
    behind.forEach(el => { el.inert = open; });
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => { menu.classList.add('is-open'); const a = $('a', menu); if (a) a.focus({ preventScroll: true }); }));
    } else {
      menu.classList.remove('is-open');
      setTimeout(() => { if (!menu.classList.contains('is-open')) menu.hidden = true; }, reduce ? 0 : 450);
    }
    updateFab();
  }
  if (burger && menu) {
    burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
    $$('a', menu).forEach(a => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isMenuOpen()) { setMenu(false); burger.focus(); }
    });
    window.matchMedia('(min-width: 768px)').addEventListener('change', e => { if (e.matches) setMenu(false); });
  }

  /* ---------- Аккордеон «кому подходит / этапы / формат»: на телефоне свёрнут, на ПК всегда открыт ---------- */
  const mobileMQ = window.matchMedia('(max-width: 767px)');
  const infos = $$('details.info__col');
  const syncInfo = () => infos.forEach(d => {
    if (!mobileMQ.matches) { d.open = true; return; }
    if (!d.dataset.touched) d.open = d.parentElement.firstElementChild === d;
  });
  infos.forEach(d => {
    $('summary', d).addEventListener('click', () => { d.dataset.touched = '1'; });
    d.addEventListener('toggle', () => { if (!mobileMQ.matches && !d.open) d.open = true; });
  });
  mobileMQ.addEventListener('change', syncInfo);
  syncInfo();

  /* ---------- Веер карточек «обо мне»: раскрывается, когда блок в зоне видимости (вместо hover) ---------- */
  const fan = $('.fan');
  if (fan) {
    if ('IntersectionObserver' in window && !reduce) {
      new IntersectionObserver(es => es.forEach(e => fan.classList.toggle('is-open', e.isIntersecting)), { threshold: .7 }).observe(fan);
    } else { fan.classList.add('is-open'); }
  }

  /* ---------- Плавающая кнопка «написать Нике»: после героя, не поверх финала, не поверх клавиатуры ---------- */
  const fab = $('.wa-fab');
  const fabState = { past: false, end: false, typing: false };
  function updateFab() {
    if (!fab) return;
    fab.classList.toggle('is-visible', fabState.past && !fabState.end && !fabState.typing && !isMenuOpen());
  }
  if (fab && 'IntersectionObserver' in window) {
    fab.hidden = false;
    const heroEl = $('.hero'), finaleEl = $('.finale');
    if (heroEl) new IntersectionObserver(es => { fabState.past = !es[0].isIntersecting; updateFab(); }).observe(heroEl);
    if (finaleEl) new IntersectionObserver(es => { fabState.end = es[0].isIntersecting; updateFab(); }, { rootMargin: '0px 0px -20% 0px' }).observe(finaleEl);
    document.addEventListener('focusin', e => { if (e.target.matches('input')) { fabState.typing = true; updateFab(); } });
    document.addEventListener('focusout', e => { if (e.target.matches('input')) { fabState.typing = false; updateFab(); } });
  }

  /* ---------- Появление при скролле ---------- */
  const revealTargets = $$('[data-reveal], .lines');
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    revealTargets.forEach(el => io.observe(el));
  } else {
    revealTargets.forEach(el => el.classList.add('is-in'));
  }

  /* ---------- Счётчики «8» и «2 тонны» ---------- */
  const counters = $$('[data-count]');
  function run(el) {
    const to = parseFloat(el.dataset.count);
    const dur = 1400, t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(to * eased));
      if (k < 1) requestAnimationFrame(step); else el.textContent = String(to);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window && !reduce) {
    const co = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { run(en.target); co.unobserve(en.target); } });
    }, { threshold: 0.6 });
    counters.forEach(el => co.observe(el));
  }

  /* ---------- Ссылки на WhatsApp с готовым текстом под услугу ---------- */
  const phone = (document.body.dataset.waPhone || '').replace(/\D/g, '');
  $$('[data-wa]').forEach(a => {
    if (!phone) return;                       // номер ещё не задан — ссылка остаётся якорем
    a.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(a.dataset.wa);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });

  /* ---------- Формы теста (без бэкенда): одна в финале, одна во вкладке «питание» ---------- */
  $$('[data-test-form]').forEach(form => {
    const msg = $('.form__msg', form);
    const endpoint = form.dataset.endpoint || '';   // появится на этапе админки
    const setMsg = (t, ok) => { msg.textContent = t; msg.classList.toggle('is-ok', !!ok); };
    const phoneOk = v => v.replace(/\D/g, '').length >= 10;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.elements.name, tel = form.elements.phone, ok = form.elements.consent;
      let bad = null;
      [name, tel].forEach(i => i.removeAttribute('aria-invalid'));
      if (!name.value.trim()) { name.setAttribute('aria-invalid', 'true'); bad = bad || name; }
      if (!phoneOk(tel.value)) { tel.setAttribute('aria-invalid', 'true'); bad = bad || tel; }
      if (bad) { setMsg('Проверь имя и номер телефона.'); bad.focus(); return; }
      if (!ok.checked) { setMsg('Нужно согласие на обработку персональных данных.'); ok.focus(); return; }
      if (!endpoint) { setMsg('Отправка ещё не подключена: это черновик вёрстки.'); return; }
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.value.trim(), phone: tel.value.trim(), consent: true }),
          credentials: 'same-origin'
        });
        if (!r.ok) throw new Error(String(r.status));
        form.reset(); setMsg('Спасибо! Ника свяжется с тобой.', true);
      } catch (_) { setMsg('Не получилось отправить. Попробуй ещё раз или напиши в WhatsApp.'); }
    });
  });
})();
