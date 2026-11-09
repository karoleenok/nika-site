/* Скрипт внутренних страниц. Без зависимостей. Страницы читаются и без него. */
(() => {
  'use strict';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- WhatsApp с готовым текстом (как на главной) ---------- */
  const phone = (document.body.dataset.waPhone || '').replace(/\D/g, '');
  if (phone) {
    $$('[data-wa]').forEach(a => {
      a.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(a.dataset.wa);
      a.target = '_blank'; a.rel = 'noopener noreferrer';
    });
  }

  /* ---------- Юр. страницы: оглавление из заголовков h2 ---------- */
  const prose = $('.legal .prose');
  const toc = $('.toc');
  if (prose && toc) {
    const list = $('.toc__list', toc);
    const heads = $$('h2', prose);
    if (!heads.length) {
      list.innerHTML = '<li class="toc__empty">Оглавление появится, когда в документ вставят текст.</li>';
    } else {
      heads.forEach((h, i) => {
        h.id = h.id || 'sec-' + (i + 1);
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + h.id; a.textContent = h.textContent;
        li.appendChild(a); list.appendChild(li);
      });
      if ('IntersectionObserver' in window) {
        const links = $$('a', list);
        const io = new IntersectionObserver(es => {
          es.forEach(e => {
            if (!e.isIntersecting) return;
            links.forEach(l => l.classList.toggle('is-current', l.hash === '#' + e.target.id));
          });
        }, { rootMargin: '0px 0px -70% 0px' });
        heads.forEach(h => io.observe(h));
      }
    }
    // на ПК оглавление открыто, на мобилке свёрнуто
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => { toc.open = mq.matches; };
    sync(); mq.addEventListener('change', sync);
  }

  /* ---------- «Спасибо»: тексты под тип события (?t=lead | pay | test) ---------- */
  const ty = $('[data-ty]');
  if (ty) {
    const V = {
      lead: {
        title: 'Заявка<br>принята',
        lead: 'Ника свяжется с тобой в WhatsApp или по телефону, который ты оставил(а). Обычно этого достаточно, чтобы выбрать формат и начать.',
        steps: ['Ника посмотрит заявку и твой запрос.', 'Напишет тебе и уточнит цель, опыт и удобный график.', 'Предложит подходящий формат и тариф.'],
        note: ''
      },
      pay: {
        title: 'Оплата<br>прошла',
        lead: 'Спасибо. Чек придёт на почту, которую ты указал(а) при оплате.',
        steps: ['Проверь почту: там чек и данные для входа.', 'Войди в личный кабинет, доступ уже открыт.', 'Если что-то не открылось, напиши Нике в WhatsApp.'],
        note: ''
      },
      test: {
        title: 'Тест<br>пройден',
        lead: 'Ника посмотрит ответы и пришлёт предварительный список анализов и рекомендаций.',
        steps: ['Ника изучит твои ответы.', 'Свяжется с тобой и расскажет, какие обследования стоит пройти.', 'Выдаст направление на анализы.'],
        note: 'Это рекомендации по обследованиям, а не диагноз. Диагноз и лечение назначает врач.'
      }
    };
    const key = new URLSearchParams(location.search).get('t');
    const v = V[key] || null;
    if (v) {
      $('[data-ty-title]').innerHTML = v.title;
      $('[data-ty-lead]').textContent = v.lead;
      const ol = $('[data-ty-steps]'); ol.textContent = '';
      v.steps.forEach(t => { const li = document.createElement('li'); li.textContent = t; ol.appendChild(li); });
      const note = $('[data-ty-note]'); note.textContent = v.note; note.hidden = !v.note;
      document.title = v.title.replace('<br>', ' ') + ' — Ника Дупина';
      ty.dataset.ty = key;
    }
    // кнопка в кабинет нужна только после оплаты
    const lk = $('[data-ty-account]');
    if (lk) lk.hidden = ty.dataset.ty !== 'pay';
  }

  /* ---------- Кейсы: фильтр по категории, #body | #habits | #form ---------- */
  const chips = $$('.chip[data-cat]');
  const stories = $$('.story[data-cat]');
  if (chips.length && stories.length) {
    const apply = (cat, push) => {
      chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.cat === cat)));
      let i = 0;
      stories.forEach(s => {
        const show = cat === 'all' || s.dataset.cat === cat;
        s.hidden = !show;
        s.classList.remove('is-shown');
        if (show) {
          s.style.setProperty('--d', (i++ * 0.05) + 's');
          void s.offsetWidth;                // перезапуск анимации
          s.classList.add('is-shown');
        }
      });
      if (push) { try { history.replaceState(null, '', cat === 'all' ? location.pathname : '#' + cat); } catch (_) {} }
    };
    chips.forEach(c => c.addEventListener('click', () => apply(c.dataset.cat, true)));
    const fromHash = location.hash.slice(1);
    apply(chips.some(c => c.dataset.cat === fromHash) ? fromHash : 'all', false);
  }

  /* ---------- Материал: липкая панель покупки на мобилке ---------- */
  const bar = $('.buybar');
  const main = $('[data-buy-main]');
  if (bar && main && 'IntersectionObserver' in window) {
    document.body.classList.add('has-buybar');
    new IntersectionObserver(es => bar.classList.toggle('is-visible', !es[0].isIntersecting && es[0].boundingClientRect.top < 0), { threshold: 0 }).observe(main);
  }
})();
