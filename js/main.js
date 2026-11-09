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
    // кнопка свёрнута в круг; когда скролл стоит почти секунду, раскрывается в «написать Нике»
    let idle;
    addEventListener('scroll', () => { fab.classList.remove('is-open'); clearTimeout(idle); idle = setTimeout(() => fab.classList.add('is-open'), 900); }, { passive: true });
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

  /* ---------- Мобильные карусели: точки-индикаторы ---------- */
  (() => {
    const mq = window.matchMedia('(max-width: 767px)');
    $$('.tariffs, .cases__grid, .shop__grid').forEach(list => {
      const items = [...list.children];
      if (items.length < 2) return;
      const dots = document.createElement('div');
      dots.className = 'carousel-dots'; dots.setAttribute('aria-hidden', 'true');
      items.forEach(() => dots.appendChild(document.createElement('i')));
      list.after(dots);
      const sync = () => {
        const max = list.scrollWidth - list.clientWidth;
        let idx = 0;
        if (max > 0) {
          idx = list.scrollLeft >= max - 4 ? items.length - 1
            : Math.round(list.scrollLeft / (items[1].offsetLeft - items[0].offsetLeft));
        }
        [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i === idx));
      };
      const toggle = () => { dots.hidden = !mq.matches || list.scrollWidth <= list.clientWidth + 8; sync(); };
      list.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
      mq.addEventListener('change', toggle); new ResizeObserver(toggle).observe(list);
      toggle();
    });
  })();

  /* ---------- Магазин на мобилке: обложки листаются тапом, не лежат веером ---------- */
  (() => {
    const mq = window.matchMedia('(max-width: 767px)');
    $$('.stack--shop').forEach(stack => {
      const cards = [...stack.querySelectorAll('.stack__cover, .stack__ph')].sort((a, b) => b.matches('.stack__cover') - a.matches('.stack__cover'));
      if (cards.length < 2) return;
      const dots = document.createElement('div');
      dots.className = 'stack__dots'; dots.setAttribute('aria-hidden', 'true');
      cards.forEach(() => dots.appendChild(document.createElement('i')));
      let idx = 0;
      const paint = () => {
        cards.forEach((c, i) => {
          c.classList.toggle('is-active', i === idx);
          c.classList.toggle('is-before', i < idx);
          c.classList.toggle('is-after', i > idx);
        });
        [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i === idx));
        stack.setAttribute('aria-label', 'Превью материала, ' + (idx + 1) + ' из ' + cards.length + '. Нажми, чтобы листать');
      };
      const next = () => { idx = (idx + 1) % cards.length; paint(); };
      const onKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); } };
      const toggle = () => {
        if (mq.matches) {
          stack.dataset.cycle = ''; stack.removeAttribute('aria-hidden');
          stack.setAttribute('role', 'button'); stack.tabIndex = 0;
          stack.appendChild(dots); idx = 0; paint();
          stack.addEventListener('click', next); stack.addEventListener('keydown', onKey);
        } else {
          delete stack.dataset.cycle; stack.setAttribute('aria-hidden', 'true');
          stack.removeAttribute('role'); stack.removeAttribute('aria-label'); stack.removeAttribute('tabindex');
          stack.removeEventListener('click', next); stack.removeEventListener('keydown', onKey);
          dots.remove(); cards.forEach(c => c.classList.remove('is-active', 'is-before', 'is-after'));
        }
      };
      mq.addEventListener('change', toggle); toggle();
    });
  })();

  /* ---------- Рилсы в «обо мне» (веер на ПК, полоса на мобилке): беззвучное превью играет, пока карточка на экране; тап включает звук ---------- */
  (() => {
    const btns = $$('.reel__btn');
    if (!btns.length) return;
    const vids = btns.map(b => $('video', b));
    const label = (b, on) => {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', b.getAttribute('aria-label').replace(/\. .*$/, '') + (on ? '. Выключить звук' : '. Включить звук'));
    };
    const play = v => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    btns.forEach((b, i) => b.addEventListener('click', () => {
      const v = vids[i], on = v.muted;           // был без звука → включаем
      vids.forEach((o, j) => { o.muted = true; label(btns[j], false); });
      v.muted = !on; label(b, on);
      if (on) { v.currentTime = 0; play(v); }
    }));
    if (reduce || !('IntersectionObserver' in window)) return;   // без анимации: остаётся постер
    const io = new IntersectionObserver(es => es.forEach(e => {
      const v = e.target;
      if (e.isIntersecting) play(v);
      else { v.pause(); if (!v.muted) { v.muted = true; label(btns[vids.indexOf(v)], false); } }
    }), { threshold: .6 });
    vids.forEach(v => io.observe(v));
    document.addEventListener('visibilitychange', () => { if (document.hidden) vids.forEach(v => v.pause()); });
  })();

  /* iOS Safari включает :active только если на странице есть touchstart-слушатель.
     Нужно для красной вспышки иконок в подвале при тапе. */
  document.addEventListener('touchstart', () => {}, { passive: true });
})();
