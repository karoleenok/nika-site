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

  /* ---------- Кейсы: лента, «до / после», ракурс, «читать полностью» ---------- */
  const track = $('#cs-track');
  if (track) {
    const setView = (card) => {
      const before = card.dataset.view === 'before';
      $('.cs-ph__b', card).setAttribute('aria-hidden', String(!before));
      $('.cs-ph__a', card).setAttribute('aria-hidden', String(before));
      $$('.cs-vbtn', card).forEach(b => b.setAttribute('aria-pressed', String((b.dataset.view === 'before') === before)));
    };
    $$('.cs-card[data-id]', track).forEach(card => {
      setView(card);
      $$('.cs-vbtn', card).forEach(b => b.addEventListener('click', () => { card.dataset.view = b.dataset.view; setView(card); }));
      $$('.cs-ang', card).forEach(b => b.addEventListener('click', () => {
        card.dataset.angle = b.dataset.angle;
        $$('.cs-ang', card).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        $('.cs-ph__b', card).src = 'assets/img/cases/' + card.dataset.id + '_' + b.dataset.angle + '_b.webp';
        $('.cs-ph__a', card).src = 'assets/img/cases/' + card.dataset.id + '_' + b.dataset.angle + '_a.webp';
      }));
      const tog = $('.cs-tog', card);
      if (tog) tog.addEventListener('click', () => {
        const open = card.classList.toggle('is-open');
        tog.setAttribute('aria-expanded', String(open));
        tog.textContent = open ? 'свернуть' : 'читать полностью';
      });
    });
    const prev = $('.cs-arrow[data-dir="-1"]'), next = $('.cs-arrow[data-dir="1"]'), thumb = $('.cs-prog__thumb');
    const step = (d) => () => track.scrollBy({ left: d * (track.firstElementChild.offsetWidth + 12), behavior: 'smooth' });
    if (prev) prev.addEventListener('click', step(-1));
    if (next) next.addEventListener('click', step(1));
    const upd = () => {
      const max = track.scrollWidth - track.clientWidth;
      const p = max > 0 ? track.scrollLeft / max * 100 : 100;
      const v = Math.max(12, Math.min(100, track.clientWidth / track.scrollWidth * 100));
      if (prev) prev.disabled = p <= 1;
      if (next) next.disabled = p >= 99;
      if (thumb) { thumb.style.width = v + '%'; thumb.style.marginLeft = ((100 - v) * p / 100) + '%'; }
    };
    track.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    upd();
  }

  /* ---------- Материал: липкая панель покупки на мобилке ---------- */
  const bar = $('.buybar');
  const main = $('[data-buy-main]');
  if (bar && main && 'IntersectionObserver' in window) {
    document.body.classList.add('has-buybar');
    new IntersectionObserver(es => bar.classList.toggle('is-visible', !es[0].isIntersecting && es[0].boundingClientRect.top < 0), { threshold: 0 }).observe(main);
  }
})();
