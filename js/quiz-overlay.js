/* Тест-оверлей на главной (данные и тексты: js/quiz-data.js).
   Кнопка [data-quiz-open] открывает окно: на телефоне на весь экран, на ПК по центру.
   «Назад» в браузере и Escape закрывают окно, прокрутка страницы под ним заблокирована.
   Ответы живут только в памяти страницы: это данные о здоровье, в браузере не сохраняем.
   Закрыл и открыл снова, не перезагружая страницу: тест продолжается с того же места. */
(() => {
  'use strict';
  const D = window.NikaQuizData;
  if (!D) return;
  const { SETTINGS, STEPS, BLOCKS, TEXTS } = D;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NB = ' ';
  // Предлоги и союзы до 3 букв не оставляем в конце строки (как js/typo.js на статичных текстах)
  const nb = (t) => String(t).replace(/(^|[\s(«])([А-Яа-яЁё]{1,3})\s+(?=\S)/g, '$1$2' + NB).replace(/\s+([—–])/g, NB + '$1');
  // Все тексты проходят через gx: род («сдавал(а)») подставляется по полу из первого вопроса
  const T = (t) => D.gx(t, A.sex);
  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = T(text); return n; };
  const icon = (d, size = 20) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p); return s;
  };
  const ICO_X = 'M6 6l12 12M18 6L6 18', ICO_BACK = 'M15 5l-7 7 7 7';

  /* ---------- Состояние (только в памяти) ---------- */
  const A = {};            // ответы части 1: id шага → значение
  const CHK = {};          // чек-лист: id пункта → true | число
  let consent = false;
  let qsMark = null;       // подсветить неотвеченные уточнения (ставит renderQs)
  let quizKey = null, who = { name: '', phone: '' };   // ключ анкеты из заявки и контакт из формы
  let saveState = 'idle', serverPromo = null;       // idle | sending | ok | fail | none
  let idx = 0;             // 0 = вводный экран, 1..N = шаги, N+1 = чек-лист, N+2 = итог
  const N = STEPS.length, I_CHECK = N + 1, I_QS = N + 2, I_RESULT = N + 3;

  let root = null, panel, body, foot, titleEl, progBar, partEl, btnNext, btnBack, meta, opener = null, pushed = false, scrollY = 0;

  const sex = () => A.sex;

  /* ---------- Каркас ---------- */
  const build = () => {
    root = h('div', 'qo'); root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'qo-title');
    const back = h('div', 'qo__back'); back.addEventListener('click', () => requestClose());
    panel = h('div', 'qo__panel');
    const head = h('header', 'qo__head');
    partEl = h('p', 'qo__part');
    const x = h('button', 'qo__x'); x.type = 'button'; x.setAttribute('aria-label', 'Закрыть тест'); x.appendChild(icon(ICO_X));
    x.addEventListener('click', () => requestClose());
    head.append(partEl, x);
    const prog = h('div', 'qo__prog'); prog.setAttribute('aria-hidden', 'true'); progBar = h('i'); prog.appendChild(progBar);
    body = h('div', 'qo__body');
    foot = h('footer', 'qo__foot');
    meta = h('p', 'qo__meta'); meta.hidden = true; meta.setAttribute('aria-live', 'polite');
    const row = h('div', 'qo__row');
    btnBack = h('button', 'btn qo__prev', 'назад'); btnBack.type = 'button';
    btnBack.addEventListener('click', () => go(idx - 1, -1));
    btnNext = h('button', 'btn btn--red qo__next', 'дальше'); btnNext.type = 'button';
    btnNext.addEventListener('click', onNext);
    row.append(btnBack, btnNext); foot.append(meta, row);
    panel.append(head, prog, body, foot);
    root.append(back, panel);
    document.body.appendChild(root);
    root.addEventListener('keydown', trap);
  };

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
  const trap = (e) => {
    if (e.key !== 'Tab') return;
    const f = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  /* ---------- Открытие и закрытие ---------- */
  const lockScroll = () => {
    scrollY = window.scrollY;
    const sb = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.classList.add('qo-lock');
    if (sb > 0) document.body.style.paddingRight = sb + 'px';
  };
  const unlockScroll = () => {
    document.documentElement.classList.remove('qo-lock');
    document.body.style.paddingRight = '';
    window.scrollTo(0, scrollY);
  };

  const open = (from) => {
    if (!root) build();
    opener = from || document.activeElement;
    lockScroll();
    root.hidden = false;
    void root.offsetWidth;
    root.classList.add('is-open');
    try { history.pushState({ nikaQuiz: 1 }, ''); pushed = true; } catch (_) { pushed = false; }
    go(idx, 0);
    document.addEventListener('keydown', onKey);
  };
  const hide = () => {
    if (!root || root.hidden) return;
    document.removeEventListener('keydown', onKey);
    root.classList.remove('is-open');
    const done = () => { root.hidden = true; unlockScroll(); if (opener && opener.focus) opener.focus({ preventScroll: true }); };
    if (reduce) done(); else setTimeout(done, 220);
  };
  // Крестик и Escape: возвращаем историю назад, остальное сделает popstate
  const requestClose = () => { if (pushed) { pushed = false; history.back(); } else hide(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); requestClose(); } };
  window.addEventListener('popstate', () => { pushed = false; hide(); });

  // Окно открывает форма на главной (js/main.js) после того, как заявка принята
  window.NikaQuiz = {
    open: (from, ctx) => {
      quizKey = (ctx && ctx.key) || null;
      who = { name: (ctx && ctx.name) || '', phone: (ctx && ctx.phone) || '' };
      saveState = 'idle'; serverPromo = null;
      open(from);
    },
  };

  /* ---------- Навигация по экранам ---------- */
  const go = (to, dir) => {
    idx = Math.max(0, Math.min(I_RESULT, to));
    body.innerHTML = '';
    const view = h('div', 'qo__view' + (dir && !reduce ? (dir > 0 ? ' is-fwd' : ' is-back') : ''));
    body.appendChild(view);
    meta.hidden = true;
    foot.classList.remove('is-result');
    btnBack.hidden = idx === 0 || idx === I_RESULT;
    btnNext.hidden = false;
    btnNext.textContent = 'дальше';
    let t;
    if (idx === 0) t = renderIntro(view);
    else if (idx <= N) t = renderStep(view, STEPS[idx - 1]);
    else if (idx === I_CHECK) t = renderCheck(view);
    else if (idx === I_QS) t = renderQs(view);
    else t = renderResult(view);
    titleEl = t;
    if (t) { t.id = 'qo-title'; t.tabIndex = -1; }
    // Прогресс и подпись части
    const total = N + 2;
    progBar.style.width = (idx >= I_RESULT ? 100 : (idx / total) * 100) + '%';
    partEl.textContent = idx === 0 ? 'тест' : idx <= N ? 'часть 1 · ' + idx + ' из ' + N : idx === I_CHECK ? 'часть 2 · 1 из 2' : idx === I_QS ? 'часть 2 · 2 из 2' : 'результат';
    body.scrollTop = 0;
    validate();
    if (dir !== 0 || idx === 0) { requestAnimationFrame(() => { if (t) t.focus({ preventScroll: true }); }); }
  };

  const onNext = () => {
    if (btnNext.disabled) return;
    if (idx === I_QS && !qsDone()) { if (qsMark) qsMark(); return; }   // не пускаем дальше, показываем красным, что осталось
    go(idx + 1, 1);
  };

  const validate = () => {
    let ok = true;
    if (idx === 0) ok = consent;
    else if (idx <= N) ok = stepValid(STEPS[idx - 1]);
    btnNext.disabled = !ok;
  };

  /* ---------- Вводный экран ---------- */
  const heading = (kicker, text) => {
    const w = h('div', 'qo__top');
    if (kicker) w.appendChild(h('p', 'qo__kicker', kicker));
    const t = h('h2', 'display qo__title', nb(text)); w.appendChild(t);
    return { w, t };
  };

  const renderIntro = (view) => {
    const { w, t } = heading(null, 'Какие анализы сдать');
    view.appendChild(w);
    view.appendChild(h('p', 'qo__lead', nb('Ответь на несколько вопросов, и Ника подскажет, на какие показатели в анализах стоит обратить внимание. Это займёт около пяти минут.')));
    const ul = h('ul', 'qo__facts');
    ['Сначала короткие вопросы про тебя, потом чек-лист по самочувствию.',
     'В конце получишь рекомендацию и промокод на анализы.',
     'Ответы увидит только Ника. Хранятся до года, удалить их можно по твоей просьбе.'].forEach((s) => ul.appendChild(h('li', null, nb(s))));
    view.appendChild(ul);
    const lb = h('label', 'qo__consent'), inp = document.createElement('input');
    inp.type = 'checkbox'; inp.checked = consent;
    const sp = h('span');
    sp.append('Я' + NB + 'даю ');
    const a = h('a', null, 'согласие на' + NB + 'обработку данных о' + NB + 'здоровье'); a.href = SETTINGS.healthConsentUrl; a.target = '_blank'; a.rel = 'noopener';
    sp.appendChild(a);
    lb.append(inp, sp);
    inp.addEventListener('change', () => { consent = inp.checked; validate(); });
    view.appendChild(lb);
    view.appendChild(h('p', 'qo__fine', nb(TEXTS.disclaimer)));
    btnNext.textContent = 'начать';
    return t;
  };

  /* ---------- Часть 1: экраны вопросов ---------- */
  const val = (id) => A[id];
  const chipsState = (s) => (A[s.id] = A[s.id] || { sel: [], other: '', otherOn: false });
  const ynState = (s) => (A[s.id] = A[s.id] || { yes: null, text: '' });

  const stepValid = (s) => {
    if (s.type === 'sex' || s.type === 'level') return !!A[s.id];
    if (s.type === 'wheel') return typeof A[s.id] === 'number';
    if (s.type === 'chips') { const c = chipsState(s); return (c.sel.length > 0 || (c.otherOn && c.other.trim().length > 0)) && (!c.otherOn || c.other.trim().length > 0); }
    if (s.type === 'yn') return ynState(s).yes !== null;
    return true;
  };

  const renderStep = (view, s) => {
    const title = s.id === 'activity' ? D.activityTitle(sex()) : s.title;
    const { w, t } = heading(null, title);
    view.appendChild(w);
    if (s.hint) view.appendChild(h('p', 'qo__hint', nb(s.hint)));
    if (s.type === 'sex') sexStep(view, s);
    else if (s.type === 'wheel') wheelStep(view, s);
    else if (s.type === 'chips') chipsStep(view, s);
    else if (s.type === 'level') levelStep(view, s);
    else if (s.type === 'yn') ynStep(view, s);
    if (idx === N) btnNext.textContent = 'дальше';
    return t;
  };

  const sexStep = (view, s) => {
    const g = h('div', 'qo__sex'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', T(s.title));
    s.options.forEach((o) => {
      const b = h('button', 'qo__card' + (A.sex === o.id ? ' is-on' : ''), o.label); b.type = 'button';
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', A.sex === o.id ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (A.sex && A.sex !== o.id) { BLOCKS.forEach((bl) => { if (bl.sex) bl.items.forEach((i) => delete CHK[i.id]); }); }
        A.sex = o.id; g.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
        validate();
      });
      g.appendChild(b);
    });
    view.appendChild(g);
  };

  /* «Барабан» как в iOS: прокрутка со снапом + ручной ввод */
  const ROW = 48;
  const wheelStep = (view, s) => {
    const vals = [];
    for (let v = s.min; v <= s.max + 1e-9; v += s.step) vals.push(Math.round(v * 2) / 2);
    const fmt = (v) => (s.step < 1 && v % 1 ? String(v).replace('.', ',') : String(v));
    const start = typeof A[s.id] === 'number' ? A[s.id] : s.def;
    A[s.id] = start;
    let cur = Math.max(0, vals.indexOf(start)), syncing = false, raf = 0;

    const wrap = h('div', 'qo__wheelbox');
    const wheel = h('div', 'qo__wheel'); wheel.tabIndex = 0;
    wheel.setAttribute('role', 'spinbutton'); wheel.setAttribute('aria-label', T(s.title));
    wheel.setAttribute('aria-valuemin', s.min); wheel.setAttribute('aria-valuemax', s.max);
    const list = h('div', 'qo__wlist');
    const items = vals.map((v, i) => {
      const it = h('div', 'qo__wi', fmt(v)); it.dataset.i = i; list.appendChild(it); return it;
    });
    wheel.append(list, h('div', 'qo__wband'));
    wrap.appendChild(wheel);

    const field = h('label', 'qo__manual');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.inputMode = s.step < 1 ? 'decimal' : 'numeric'; inp.autocomplete = 'off'; inp.maxLength = 6;
    inp.setAttribute('aria-label', T(s.title) + ', ' + s.unit);
    field.append(inp, h('span', 'qo__unit', s.unit));
    wrap.appendChild(field);
    view.appendChild(wrap);

    const paint = () => {
      items.forEach((it, i) => { const d = Math.abs(i - cur); it.dataset.d = d > 2 ? 3 : d; });
      wheel.setAttribute('aria-valuenow', vals[cur]);
    };
    const commit = (i, fromScroll) => {
      cur = i; A[s.id] = vals[i]; paint();
      if (!(fromScroll && document.activeElement === inp)) inp.value = fmt(vals[i]);
      validate();
    };
    const scrollTo = (i, smooth) => {
      syncing = true; list.scrollTo({ top: i * ROW, behavior: smooth && !reduce ? 'smooth' : 'auto' });
      setTimeout(() => { syncing = false; }, smooth ? 350 : 80);
    };
    list.addEventListener('scroll', () => {
      if (syncing) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.max(0, Math.min(vals.length - 1, Math.round(list.scrollTop / ROW)));
        if (i !== cur) commit(i, true);
      });
    }, { passive: true });
    items.forEach((it, i) => it.addEventListener('click', () => { commit(i); scrollTo(i, true); }));
    wheel.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : e.key === 'PageUp' ? -10 : e.key === 'PageDown' ? 10 : 0;
      if (!d) return; e.preventDefault();
      const i = Math.max(0, Math.min(vals.length - 1, cur + d)); commit(i); scrollTo(i, true);
    });
    const parse = () => parseFloat(inp.value.replace(',', '.'));
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(s.step < 1 ? /[^\d.,]/g : /\D/g, '');
      const n = parse();
      if (Number.isFinite(n) && n >= s.min && n <= s.max) {
        const r = Math.round(n / s.step) * s.step, i = vals.indexOf(Math.round(r * 2) / 2);
        if (i >= 0) { cur = i; A[s.id] = vals[i]; paint(); scrollTo(i, true); }
        validate();
      } else { btnNext.disabled = true; }
    });
    inp.addEventListener('blur', () => {
      const n = parse();
      const c = Number.isFinite(n) ? Math.max(s.min, Math.min(s.max, n)) : vals[cur];
      const i = Math.max(0, vals.indexOf(Math.round(Math.round(c / s.step) * s.step * 2) / 2));
      commit(i); scrollTo(i, false);
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); if (!btnNext.disabled) onNext(); } });
    // Начальная позиция после того, как блок попал в разметку
    requestAnimationFrame(() => { scrollTo(cur, false); commit(cur); });
  };

  const chipsStep = (view, s) => {
    const c = chipsState(s);
    const box = h('div', 'qo__chips'); box.setAttribute('role', s.multi ? 'group' : 'radiogroup'); box.setAttribute('aria-label', T(s.title));
    const chips = [];
    const draw = () => chips.forEach(([b, id]) => {
      const on = id === '__other' ? c.otherOn : c.sel.includes(id);
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const pick = (id) => {
      const opt = s.options.find((o) => o.id === id);
      if (s.multi) {
        if (c.sel.includes(id)) c.sel = c.sel.filter((x) => x !== id);
        else {
          if (opt && opt.only) { c.sel = [id]; c.otherOn = false; ta.hidden = true; }
          else c.sel = c.sel.filter((x) => !(s.options.find((o) => o.id === x) || {}).only).concat(id);
        }
      } else { c.sel = c.sel[0] === id ? [] : [id]; c.otherOn = false; }
      ta.hidden = !c.otherOn; draw(); validate();
    };
    s.options.forEach((o) => { const b = h('button', 'qo__chip', o.label); b.type = 'button'; b.addEventListener('click', () => pick(o.id)); box.appendChild(b); chips.push([b, o.id]); });
    const ta = h('div', 'qo__other'); ta.hidden = !c.otherOn;
    const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 200; inp.placeholder = 'напиши своими словами'; inp.value = c.other;
    inp.setAttribute('aria-label', 'Другое: ' + s.title);
    inp.addEventListener('input', () => { c.other = inp.value; validate(); });
    ta.appendChild(inp);
    if (s.other) {
      const b = h('button', 'qo__chip qo__chip--other', 'другое'); b.type = 'button';
      b.addEventListener('click', () => {
        c.otherOn = !c.otherOn;
        if (c.otherOn) { if (!s.multi) c.sel = []; else c.sel = c.sel.filter((x) => !(s.options.find((o) => o.id === x) || {}).only); }
        ta.hidden = !c.otherOn; draw(); validate(); if (c.otherOn) inp.focus();
      });
      box.appendChild(b); chips.push([b, '__other']);
    }
    view.append(box, ta); draw();
  };

  const levelStep = (view, s) => {
    const g = h('div', 'qo__levels'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', T(s.title));
    s.options.forEach((o, i) => {
      const b = h('button', 'qo__level' + (A[s.id] === o.id ? ' is-on' : '')); b.type = 'button';
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', A[s.id] === o.id ? 'true' : 'false');
      const dots = h('span', 'qo__dots'); dots.setAttribute('aria-hidden', 'true');
      for (let k = 0; k < 5; k++) dots.appendChild(h('i', k <= i ? 'on' : ''));
      const tx = h('span', 'qo__lt'); tx.append(h('b', null, o.label), h('small', null, nb(o.sub)));
      b.append(dots, tx);
      b.addEventListener('click', () => {
        A[s.id] = o.id;
        g.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
        validate();
      });
      g.appendChild(b);
    });
    view.appendChild(g);
  };

  const ynStep = (view, s) => {
    const st = ynState(s);
    const g = h('div', 'qo__yn'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', T(s.title));
    const ask = h('div', 'qo__ask'); ask.hidden = st.yes !== true;
    ask.appendChild(h('p', 'qo__asklabel', s.ask));
    const ta = document.createElement('textarea'); ta.rows = 3; ta.maxLength = 300; ta.value = st.text; ta.placeholder = 'можно коротко';
    ta.setAttribute('aria-label', T(s.ask));
    ta.addEventListener('input', () => { st.text = ta.value; });
    ask.appendChild(ta);
    [['yes', true, 'да'], ['no', false, 'нет']].forEach(([id, v, label]) => {
      const b = h('button', 'qo__card qo__card--sm' + (st.yes === v ? ' is-on' : ''), label); b.type = 'button';
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', st.yes === v ? 'true' : 'false');
      b.addEventListener('click', () => {
        st.yes = v; if (!v) st.text = '';
        g.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
        ask.hidden = !v; if (v) ta.focus({ preventScroll: true }); validate();
      });
      g.appendChild(b);
    });
    view.append(g, ask);
  };

  /* ---------- Часть 2: один экран-чек-лист ---------- */
  const visibleBlocks = () => BLOCKS.filter((b) => !b.sex || b.sex === sex());
  const visibleItems = (b) => b.items.filter((i) => !i.sex || i.sex === sex());
  const countOf = (b) => visibleItems(b).filter((i) => i.count && i.kind !== 'n' && CHK[i.id] === true).length;
  const checkedTotal = () => visibleBlocks().reduce((n, b) => n + visibleItems(b).filter((i) => i.kind === 's' && CHK[i.id] === true).length, 0);
  const qItems = () => visibleBlocks().flatMap((b) => visibleItems(b).filter((i) => i.kind !== 's'));
  const answeredQ = (i) => (i.kind === 'q' ? typeof CHK[i.id] === 'boolean' : typeof CHK[i.id] === 'number');
  const qsDone = () => qItems().every(answeredQ);

  const renderCheck = (view) => {
    const { w, t } = heading(null, 'Что из этого про тебя?');
    view.appendChild(w);
    view.appendChild(h('p', 'qo__hint', nb('Отметь всё, что подходит. Если сомневаешься, не отмечай.')));
    const upd = () => { meta.textContent = 'отмечено ' + checkedTotal(); };
    visibleBlocks().forEach((b) => {
      const its = visibleItems(b).filter((i) => i.kind === 's');
      if (!its.length) return;
      const sec = h('div', 'qo__sec'); sec.setAttribute('role', 'group');
      its.forEach((i) => {
        const lb = h('label', 'qo__chk'), inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = CHK[i.id] === true;
        inp.addEventListener('change', () => { CHK[i.id] = inp.checked; upd(); });
        lb.append(inp, h('span', 'qo__box'), h('span', 'qo__ct', nb(i.text))); sec.appendChild(lb);
      });
      view.appendChild(sec);
    });
    meta.hidden = false; upd();
    btnNext.textContent = 'дальше';
    return t;
  };

  /* Часть 2, экран 2: уточнения. Каждый вопрос обязателен: да или нет, число вводится вручную */
  const renderQs = (view) => {
    const { w, t } = heading(null, 'Несколько уточнений');
    view.appendChild(w);
    view.appendChild(h('p', 'qo__hint', nb('Ответь на каждый вопрос: «да» или «нет».')));
    const rows = []; let showMiss = false;
    const paint = () => {
      const miss = rows.filter(([, i]) => !answeredQ(i));
      rows.forEach(([row, i]) => { const bad = showMiss && !answeredQ(i); row.classList.toggle('is-missing', bad); if (bad) row.setAttribute('aria-invalid', 'true'); else row.removeAttribute('aria-invalid'); });
      meta.classList.toggle('is-bad', showMiss && miss.length > 0);
      return miss;
    };
    const upd = () => {
      const all = qItems(), left = all.length - all.filter(answeredQ).length;
      meta.textContent = showMiss && left ? 'не отвечено: ' + left + ' из ' + all.length + ' (отмечено красным)' : 'отвечено ' + (all.length - left) + ' из ' + all.length;
      paint();
    };
    qsMark = () => {
      showMiss = true; upd();
      const first = rows.find(([, i]) => !answeredQ(i));
      if (first) { first[0].scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); }
    };
    visibleBlocks().forEach((b) => {
      const its = visibleItems(b).filter((i) => i.kind !== 's');
      if (!its.length) return;
      const sec = h('div', 'qo__sec');
      its.forEach((i) => {
        const row = h('div', 'qo__q'); rows.push([row, i]);
        row.appendChild(h('p', 'qo__ct', nb(i.text)));
        if (i.kind === 'q') {
          const g = h('div', 'qo__seg'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', T(i.text));
          [[true, 'да'], [false, 'нет']].forEach(([v, label]) => {
            const bt = h('button', 'qo__segb', label); bt.type = 'button'; bt.setAttribute('role', 'radio');
            const draw = () => { const on = CHK[i.id] === v; bt.classList.toggle('is-on', on); bt.setAttribute('aria-checked', on ? 'true' : 'false'); };
            bt.addEventListener('click', () => { CHK[i.id] = v; g.querySelectorAll('button').forEach((x) => x.dispatchEvent(new Event('qo-draw'))); upd(); });
            bt.addEventListener('qo-draw', draw); draw(); g.appendChild(bt);
          });
          row.appendChild(g);
        } else {
          const box = h('div', 'qo__numin'), inp = document.createElement('input');
          inp.type = 'text'; inp.inputMode = 'numeric'; inp.maxLength = 2; inp.placeholder = '—';
          inp.setAttribute('aria-label', T(i.text));
          inp.value = typeof CHK[i.id] === 'number' ? CHK[i.id] : '';
          inp.addEventListener('input', () => {
            inp.value = inp.value.replace(/\D/g, '');
            const n = parseInt(inp.value, 10);
            if (Number.isFinite(n) && n >= i.num.min && n <= i.num.max) CHK[i.id] = n; else delete CHK[i.id];
            upd();
          });
          box.append(inp, h('span', 'qo__unit', i.num.unit)); row.appendChild(box); row.classList.add('qo__q--num');
        }
        sec.appendChild(row);
      });
      view.appendChild(sec);
    });
    meta.hidden = false; upd();
    btnNext.textContent = 'посмотреть результат';
    return t;
  };

  /* ---------- Итог ---------- */
  const flagged = () => visibleBlocks().filter((b) => countOf(b) >= b.threshold);

  // Отправка ответов на сервер. Ключ из заявки одноразовый, поэтому одна попытка на заявку
  const save = async (done) => {
    if (saveState !== 'idle') return;
    if (!quizKey) { saveState = 'none'; return; }
    saveState = 'sending';
    const keep = new Set(visibleBlocks().flatMap((b) => visibleItems(b).map((i) => i.id)));   // пункты другого пола не шлём
    const c = {}; Object.keys(CHK).forEach((k) => { if (keep.has(k)) c[k] = CHK[k]; });
    try {
      const r = await fetch('/api/quiz', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: quizKey, version: D.VERSION, healthConsent: true, answers: { a: A, c } }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { saveState = 'ok'; if (j.promo && j.promo.code) serverPromo = j.promo; } else saveState = 'fail';
    } catch (_) { saveState = 'fail'; }
    quizKey = null;
    if (done) done();
  };

  const waLink = (fl) => {
    const names = fl.filter((b) => !b.repro).map((b) => b.short);   // про половые гормоны в сообщение не пишем
    const text = names.length
      ? 'Здравствуйте, Ника! Я прошёл(ла) тест на сайте. По результатам выделились блоки: ' + names.join(', ') + '. Хочу записаться на консультацию, чтобы разобрать мою ситуацию по анализам.'
      : 'Здравствуйте, Ника! Я прошёл(ла) тест на сайте. Хочу записаться на консультацию, чтобы разобрать мою ситуацию по анализам.';
    // Если ответы на сервер не попали, контакт передаём в самом сообщении
    const who2 = saveState !== 'ok' && saveState !== 'sending' && who.name ? ' Меня зовут ' + who.name + ', мой номер: ' + who.phone + '.' : '';
    return 'https://wa.me/' + SETTINGS.waPhone + '?text=' + encodeURIComponent(T(text + who2));
  };

  const renderResult = (view) => {
    foot.classList.add('is-result'); btnNext.hidden = true; btnBack.hidden = true;
    const { w, t } = heading('результат', 'Что смотреть в анализах');
    view.appendChild(w);
    view.appendChild(h('p', 'qo__p', TEXTS.head));
    const fl = flagged();
    const note = h('p', 'qo__fine'); note.hidden = true;
    if (fl.length) {
      const list = h('div', 'qo__blocks');
      fl.forEach((b) => { const c = h('div', 'qo__blk'); c.append(h('p', 'qo__bl', b.short), h('p', null, TEXTS.blocks[b.id])); list.appendChild(c); });
      view.appendChild(list);
    } else view.appendChild(h('p', 'qo__p', TEXTS.none));
    view.appendChild(h('p', 'qo__p', TEXTS.conclusion));

    // Промокод: с сервера (после сохранения анкеты); в публичном JS его нет. ?promo-preview показывает макет
    const promo = h('div', 'qo__promo');
    const paintPromo = () => {
      const P = serverPromo || (/[?&]promo-preview\b/.test(location.search) ? SETTINGS.promo : null);
      promo.textContent = '';
      if (P) {
        promo.append(h('p', 'qo__bl', 'промокод'), h('p', 'qo__code', P.code),
          h('p', 'qo__pt', nb('Скидка ' + P.percent + '% на анализы у партнёра. Условия расскажет Ника.')));
        const cp = h('button', 'btn btn--white qo__copy', 'скопировать'); cp.type = 'button';
        cp.addEventListener('click', async () => { try { await navigator.clipboard.writeText(P.code); cp.textContent = 'скопировано'; setTimeout(() => { cp.textContent = 'скопировать'; }, 1800); } catch (_) {} });
        promo.appendChild(cp);
      } else {
        promo.append(h('p', 'qo__bl', 'скидка на анализы'), h('p', 'qo__pt', nb('Промокод пришлёт Ника, когда ты напишешь ей в WhatsApp.')));
      }
    };
    paintPromo();
    view.appendChild(promo);

    // Действия
    const acts = h('div', 'qo__acts');
    const wa = h('a', 'btn btn--red btn--block', 'записаться на консультацию'); wa.href = waLink(fl); wa.target = '_blank'; wa.rel = 'noopener';
    acts.append(wa, h('p', 'qo__fine', nb('Откроется WhatsApp с готовым сообщением и итогом теста. Ты увидишь текст до отправки.')), note);
    const real = SETTINGS.app.links.filter((l) => l.href && l.href !== '#');
    if (real.length) {
      real.forEach((l) => { const a = h('a', 'btn btn--ink btn--block', 'скачать приложение · ' + l.label); a.href = l.href; a.target = '_blank'; a.rel = 'noopener'; acts.appendChild(a); });
    } else {
      const b = h('button', 'btn btn--block', 'скачать приложение · скоро'); b.type = 'button'; b.disabled = true; acts.appendChild(b);
    }
    view.appendChild(acts);
    view.appendChild(h('p', 'qo__fine', nb(TEXTS.disclaimer)));
    const after = () => {
      if (!view.isConnected) return;
      paintPromo(); wa.href = waLink(fl);
      note.hidden = saveState === 'ok' || saveState === 'sending';
      if (!note.hidden) note.textContent = nb('Ответы не сохранились на сайте, Ника их не увидит. Отправь итог ей в WhatsApp, контакт добавим в сообщение.');
    };
    save(after).then(after);
    const again = h('button', 'qo__again', 'пройти заново'); again.type = 'button';
    again.addEventListener('click', () => {
      Object.keys(A).forEach((k) => delete A[k]); Object.keys(CHK).forEach((k) => delete CHK[k]);
      saveState = 'idle'; quizKey = null; serverPromo = null;   // ключ одноразовый: повторное прохождение на сервер не уходит
      go(1, -1);
    });
    view.appendChild(again);
    return t;
  };
})();
