import nodemailer from 'nodemailer';

// Отправка писем. Без пикселей и отслеживания кликов: только текст и простая HTML-версия.
export function createMailer(cfg, log = console) {
  const transport = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    disableUrlAccess: true, disableFileAccess: true,
  });
  return {
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from: cfg.from, replyTo: cfg.replyTo || undefined, to, subject, text, html });
    },
    // Фоновая отправка: ответ API не ждёт письма, поэтому по скорости ответа не понять, есть ли почта в базе
    sendLater(msg) {
      this.send(msg).catch((err) => log.error({ err: { message: err.message, code: err.code } }, 'mail failed'));
    },
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(paragraphs) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;font:16px/1.5 Arial,sans-serif;color:#0e0e0e">${p}</p>`).join('');
  return `<!doctype html><html lang="ru"><body style="margin:0;padding:24px;background:#f4f2ef">
<div style="max-width:480px;margin:0 auto;padding:32px 24px;background:#ffffff;border-radius:16px">${body}</div></body></html>`;
}

export function loginCodeMail({ code, link, admin }) {
  const subject = admin ? 'Вход в админку Ники Дупиной' : 'Вход в кабинет Ники Дупиной';
  const lines = [
    `Код для входа: ${code}`,
    'Код действует 10 минут.',
    ...(link ? [`Или открой ссылку и нажми «войти в кабинет» (действует 15 минут):\n${link}`] : []),
    'Если письмо пришло случайно, просто удали его: без кода в кабинет не войти.',
  ];
  const html = layout([
    'Код для входа:',
    `<span style="display:inline-block;font:700 32px/1.2 Arial,sans-serif;letter-spacing:6px">${esc(code)}</span>`,
    'Код действует 10 минут.',
    ...(link ? [`Или войди по ссылке, она действует 15 минут:<br><a href="${esc(link)}" style="color:#d6201c">войти в кабинет</a>`] : []),
    '<span style="color:#6b6b6b;font-size:14px">Если письмо пришло случайно, просто удали его: без кода в кабинет не войти.</span>',
  ]);
  return { subject, text: lines.join('\n\n'), html };
}

export function passwordChangedMail({ removed }) {
  const what = removed ? 'Пароль для входа в кабинет убран. Теперь вход только по коду или ссылке из письма.'
                       : 'Пароль для входа в кабинет изменён.';
  const tail = 'На других устройствах выполнен выход. Если изменения сделаны без твоего ведома, ответь на это письмо.';
  return { subject: 'Изменения входа в кабинет Ники Дупиной', text: `${what}\n\n${tail}`, html: layout([esc(what), esc(tail)]) };
}

const rubles = (kop) => `${(kop / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const dateRu = (d) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Vladivostok' });

// Письмо покупателю после оплаты. Чек присылает налоговая через «Мой налог», здесь только подтверждение.
export function paidMail({ title, kop, kind, endsAt, lkUrl }) {
  const what = kind === 'access' ? `Доступ к тренировкам открыт до ${dateRu(endsAt)}.`
    : kind === 'material' ? 'Материал уже в личном кабинете.'
    : 'Ника напишет тебе в ближайшее время, чтобы договориться о дате.';
  const login = kind === 'service' ? null : `Войти в кабинет: ${lkUrl}\nВход по коду, который придёт на эту почту.`;
  const lines = [`Оплата прошла: «${title}», ${rubles(kop)}.`, what, ...(login ? [login] : []),
    'Чек придёт отдельным письмом от налоговой (сервис «Мой налог»).',
    'Если что-то не так, просто ответь на это письмо.'];
  const html = layout([
    `Оплата прошла: <b>${esc(title)}</b>, ${esc(rubles(kop))}.`, esc(what),
    ...(login ? [`<a href="${esc(lkUrl)}" style="color:#d6201c">войти в кабинет</a><br><span style="color:#6b6b6b;font-size:14px">Вход по коду, который придёт на эту почту.</span>`] : []),
    'Чек придёт отдельным письмом от налоговой (сервис «Мой налог»).',
    '<span style="color:#6b6b6b;font-size:14px">Если что-то не так, просто ответь на это письмо.</span>',
  ]);
  return { subject: 'Оплата прошла — Ника Дупина', text: lines.join('\n\n'), html };
}

// Уведомление Нике
export function adminPaidMail({ title, kop, email, kind, endsAt, adminUrl, test }) {
  const tail = kind === 'access' ? `Доступ открыт до ${dateRu(endsAt)}.` : kind === 'service' ? 'Нужно связаться с покупателем.' : 'Материал открыт в кабинете.';
  const lines = [`${test ? '[ТЕСТ] ' : ''}Новая оплата: «${title}», ${rubles(kop)}.`, `Покупатель: ${email}`, tail, `Админка: ${adminUrl}`];
  return { subject: `${test ? '[ТЕСТ] ' : ''}Оплата: ${title}`, text: lines.join('\n\n'), html: layout(lines.map(esc)) };
}
