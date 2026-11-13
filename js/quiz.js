/* Тест по анализам (test.html). Вопросы приходят с сервера (GET /api/quiz), там же проверяются ответы.
   Ключ заявки положила форма на главной (sessionStorage): без него ответы не к кому привязать.
   Ответы держим только в памяти страницы, в браузере не сохраняем: это данные о здоровье. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const KEY = 'nika_quiz_key';
  let key = null;
  try { key = sessionStorage.getItem(KEY); } catch (_) {}
  if (!key) { $('[data-qz-nokey]').hidden = false; return; }

  const form = $('[data-qz]'), box = $('[data-qz-steps]'), msg = $('[data-qz-msg]');
  const back = $('[data-qz-back]'), next = $('[data-qz-next]'), fin = $('[data-qz-final]');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let Q = null, steps = [], i = 0;

  const fail = () => { form.hidden = true; $('[data-qz-err]').hidden = false; };
  $('[data-qz-reload]').addEventListener('click', () => location.reload());

  const answerOf = (q, step) => {
    if (q.type === 'text') return step.querySelector('textarea').value.trim();
    const on = [...step.querySelectorAll('input:checked')].map(x => x.value);
    return q.type === 'one' ? (on[0] || null) : on;
  };
  const answered = (q, step) => {
    if (!q.required) return true;
    const v = answerOf(q, step);
    return Array.isArray(v) ? v.length > 0 : !!v;
  };

  const build = () => {
    Q.questions.forEach((q, n) => {
      const step = el('fieldset', 'qz__step'); step.hidden = true;
      const lg = el('legend', 'qz__q', q.title); lg.tabIndex = -1; step.appendChild(lg);
      if (q.hint) step.appendChild(el('p', 'qz__hint', q.hint));
      if (q.type === 'text') {
        const ta = el('textarea', 'qz__text'); ta.name = q.id; ta.maxLength = q.max || 500; ta.rows = 4;
        ta.setAttribute('aria-label', q.title); step.appendChild(ta);
      } else {
        const opts = el('div', 'qz__opts');
        q.options.forEach(o => {
          const lb = el('label', 'qz__opt'), inp = document.createElement('input');
          inp.type = q.type === 'one' ? 'radio' : 'checkbox'; inp.name = q.id; inp.value = o.id;
          if (o.only) inp.dataset.only = '1';
          lb.appendChild(inp); lb.appendChild(el('span', '', o.label)); opts.appendChild(lb);
        });
        // «Ничего из этого» снимает остальные галочки, и наоборот
        opts.addEventListener('change', e => {
          const t = e.target; msg.textContent = '';
          if (t.type !== 'checkbox' || !t.checked) return;
          opts.querySelectorAll('input:checked').forEach(x => { if (x !== t && (t.dataset.only || x.dataset.only)) x.checked = false; });
        });
        step.appendChild(opts);
      }
      step.dataset.n = n; box.appendChild(step); steps.push(step);
    });
  };

  const show = (to, dir) => {
    steps[i].hidden = true; steps[i].classList.remove('is-in', 'is-back');
    i = to;
    const s = steps[i]; s.hidden = false;
    if (!reduce) { void s.offsetWidth; s.classList.add('is-in'); if (dir < 0) s.classList.add('is-back'); }
    const last = i === steps.length - 1;
    fin.hidden = !last; back.hidden = i === 0;
    next.textContent = last ? 'отправить Нике' : 'дальше';
    $('[data-qz-count]').textContent = 'Вопрос ' + (i + 1) + ' из ' + steps.length;
    $('[data-qz-bar]').style.width = ((i + 1) / steps.length * 100) + '%';
    msg.textContent = '';
    if (dir) { $('legend', s).focus({ preventScroll: true }); form.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }
  };

  back.addEventListener('click', () => { if (i > 0) show(i - 1, -1); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (next.disabled) return;
    const q = Q.questions[i];
    if (!answered(q, steps[i])) { msg.textContent = q.type === 'multi' ? 'Отметь хотя бы один вариант.' : 'Выбери вариант.'; return; }
    if (i < steps.length - 1) { show(i + 1, 1); return; }
    const health = form.elements.health;
    if (!health.checked) { health.setAttribute('aria-invalid', 'true'); msg.textContent = 'Отметь согласие: без него Ника не сможет посмотреть ответы.'; health.focus(); return; }
    health.removeAttribute('aria-invalid');
    const answers = {};
    Q.questions.forEach((x, n) => { const v = answerOf(x, steps[n]); if (v != null && v !== '') answers[x.id] = v; });
    next.disabled = true; next.textContent = 'отправляем…';
    const r = await window.NikaApi.post('/api/quiz', { key, version: Q.version, healthConsent: true, answers });
    if (!r.ok) { next.disabled = false; next.textContent = 'отправить Нике'; msg.textContent = (r.data && r.data.error) || 'Не получилось отправить. Попробуй ещё раз.'; return; }
    try { sessionStorage.removeItem(KEY); } catch (_) {}
    location.replace('spasibo.html?t=test');
  });

  window.NikaApi.get('/api/quiz').then(r => {
    if (!r.ok || !r.data || !Array.isArray(r.data.questions)) return fail();
    Q = r.data; build(); form.hidden = false; show(0, 0);
  }).catch(fail);
})();
