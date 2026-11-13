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

  /* Кнопки покупки живут в js/pay.js. */

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
        a.href = '#' + h.id; a.textContent = h.textContent.replace(/^\d+\.\s*/, '');  // номер даёт счётчик в CSS
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
    const qs = new URLSearchParams(location.search);
    const key = qs.get('t');
    const v = V[key] ? Object.assign({}, V[key]) : null;
    /* После оплаты. Доступ открывает сервер по уведомлению Robokassa, страница только спрашивает статус заказа.
       Заказ (номер и ключ) положил в sessionStorage checkout. Если человек платил в приложении банка и вернулся
       в другом браузере, ключа нет: показываем нейтральный текст, письмо всё равно придёт. */
    let order = null;
    try { order = JSON.parse(sessionStorage.getItem('nd_order') || 'null'); } catch (_) {}
    const C = window.NDCatalog || {};
    const itemOf = o => (o && Object.prototype.hasOwnProperty.call(C, o.id) ? C[o.id] : null);
    const mark = $('.ty__mark');
    const PAY_STATES = {
      check: { title: 'Проверяем<br>оплату', lead: 'Обычно это занимает несколько секунд. Не закрывай страницу.', steps: [], note: '' },
      wait: { title: 'Оплата<br>обрабатывается', lead: 'Банк ещё не подтвердил платёж. Как только подтвердит, на почту придёт письмо, а доступ откроется сам.',
        steps: ['Проверь почту через 10–15 минут.', 'Если письма нет, а деньги списались, напиши Нике в WhatsApp: она проверит и откроет доступ вручную.'], note: '' },
      fail: { title: 'Оплата<br>не прошла', lead: 'Деньги не списались. Можно попробовать ещё раз, например другой картой или через СБП.',
        steps: ['Нажми «попробовать снова».', 'Если не получается, напиши Нике в WhatsApp: она поможет.'], note: '' }
    };
    const paidView = (it, mail) => {
      const p = Object.assign({}, V.pay);
      if (it) {
        p.lead = 'Спасибо. Заказ «' + it.title.replace(/(\d) /g, '$1\u00a0') + '» оплачен. ' + (mail ? 'Подтверждение и вход придут на ' + mail + ', чек — отдельным письмом от налоговой.' : 'Подтверждение придёт на почту, чек — отдельным письмом от налоговой.');
        p.steps = it.after === 'lk'
          ? ['Проверь почту: там подтверждение и ссылка на кабинет.', 'Войди в личный кабинет по почте, доступ уже открыт.', 'Если что-то не открылось, напиши Нике в WhatsApp.']
          : ['Ника получила заказ и напишет тебе в течение рабочего дня.', 'Вы договоритесь о дате и формате.', 'Если не дождёшься сообщения, напиши Нике в WhatsApp сам(а).'];
        p.needAccount = it.after === 'lk';
      }
      return p;
    };
    const retry = $('[data-ty-retry]');
    const drawPay = (state, it) => {
      const p = state === 'paid' ? paidView(it, order && order.email) : Object.assign({ needAccount: false }, PAY_STATES[state]);
      $('[data-ty-title]').innerHTML = p.title;
      $('[data-ty-lead]').textContent = p.lead;
      const ol = $('[data-ty-steps]'); ol.textContent = '';
      p.steps.forEach(t => { const li = document.createElement('li'); li.textContent = t; ol.appendChild(li); });
      ol.closest('section').hidden = !p.steps.length;
      if (mark) { mark.hidden = state !== 'paid'; }
      ty.dataset.ty = 'pay'; ty.dataset.payState = state;
      $('[data-ty-account]').hidden = !(state === 'paid' && p.needAccount !== false);
      const canRetry = state === 'fail' && !!it;
      if (retry) { retry.hidden = !canRetry; if (it) retry.href = 'checkout.html?item=' + encodeURIComponent(order.id); }
      const home = $('[data-ty-home]');   // красная кнопка одна: при ошибке главное действие — повторить оплату
      const toLk = state === 'paid' && p.needAccount !== false && !!it;   // после оплаты главное действие — войти в кабинет
      const acc = $('[data-ty-account]');
      if (home) { home.classList.toggle('btn--red', !canRetry && !toLk); home.classList.toggle('btn--white', canRetry || toLk); }
      if (acc) { acc.classList.toggle('btn--red', toLk); acc.classList.toggle('btn--white', !toLk); }
      document.title = p.title.replace('<br>', ' ') + ' — Ника Дупина';
    };
    const isPay = key === 'pay' || key === 'fail';
    if (key === 'fail') drawPay('fail', itemOf(order));
    else if (key === 'pay' && (!order || !order.orderId)) drawPay('paid', null);
    else if (key === 'pay') {
      const it = itemOf(order);
      drawPay('check', it);
      const started = Date.now();
      const poll = async () => {
        let st = '';
        try {
          const r = await fetch('/api/pay/status/' + encodeURIComponent(order.orderId) + '?k=' + encodeURIComponent(order.key), { cache: 'no-store', credentials: 'same-origin' });
          if (r.ok) st = (await r.json()).status;
        } catch (_) {}
        if (st === 'paid') { drawPay('paid', it); try { sessionStorage.removeItem('nd_order'); } catch (_) {} return; }
        if (st === 'failed' || st === 'refunded') { drawPay('fail', it); return; }
        if (Date.now() - started > 60e3) { drawPay('wait', it); return; }
        setTimeout(poll, Date.now() - started < 10e3 ? 1500 : 4000);   // сначала часто, потом реже
      };
      poll();
    }
    if (v && !isPay) {
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
    if (lk && !isPay) lk.hidden = !(ty.dataset.ty === 'pay' && (!v || v.needAccount !== false));
  }

  /* ---------- Кейсы: лента, «до | после», ракурс, «читать полностью» ---------- */
  const track = $('#cs-track');
  if (track) {
    $$('.cs-card[data-id]', track).forEach(card => {
      $$('.cs-ang', card).forEach(b => b.addEventListener('click', () => {
        card.dataset.angle = b.dataset.angle;
        $$('.cs-ang', card).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        const base = 'assets/img/cases/' + card.dataset.id + '_' + b.dataset.angle;
        $('.cs-img-b', card).src = base + '_b.webp';
        $('.cs-img-a', card).src = base + '_a.webp';
      }));
      const tog = $('.cs-tog', card);
      if (tog) {
        // кнопка нужна только там, где текст реально обрезан (на широкой карточке он может влезть целиком)
        const fit = () => { tog.hidden = !card.classList.contains('is-open') && !$$('.cs-p.is-clamp', card).some(p => p.scrollHeight > p.clientHeight + 1); };
        fit(); window.addEventListener('resize', fit); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
      }
      if (tog) tog.addEventListener('click', () => {
        const open = card.classList.toggle('is-open');
        tog.setAttribute('aria-expanded', String(open));
        tog.textContent = open ? 'свернуть' : 'читать историю';
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
