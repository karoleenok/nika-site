-- «Сервисы и оплаты»: за что платим, сколько и до какого числа хватит. Админка напоминает заранее.
-- paid_until — последний оплаченный день (для Timeweb это «хватит баланса до», его обновляют руками после пополнения).
CREATE TABLE services (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  what        text NOT NULL DEFAULT '',
  amount_kop  integer NOT NULL DEFAULT 0 CHECK (amount_kop >= 0),
  period      text NOT NULL CHECK (period IN ('month', 'year')),
  paid_until  date,
  pay_url     text NOT NULL DEFAULT '',
  payer       text NOT NULL DEFAULT 'nika' CHECK (payer IN ('nika', 'karolina')),
  auto_renew  boolean NOT NULL DEFAULT false,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Что уже известно на 15.11.2026. Суммы и даты Каролина сверяет в панелях и правит в админке.
INSERT INTO services (name, what, amount_kop, period, paid_until, payer, auto_renew, note) VALUES
  ('Домен nikassd.ru', 'Адрес сайта', 39900, 'year', '2027-11-14', 'nika', true,
   'Продление включено само. Сумму за продление сверить у регистратора.'),
  ('Сервер Timeweb', 'Сайт, личный кабинет и база', 214000, 'month', '2026-12-13', 'nika', false,
   'Деньги списываются с баланса Timeweb каждый день, поэтому дата примерная. После пополнения поставь новую.'),
  ('Хранилище Timeweb', 'Два бакета: видео и копии базы, по 79 ₽ в месяц', 15800, 'month', '2026-12-13', 'nika', false,
   'Списывается с того же баланса Timeweb, что и сервер.');
