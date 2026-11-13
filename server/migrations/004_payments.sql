-- Фаза 4: оплата через Robokassa.
-- Номер заказа (orders.id) уходит в Robokassa как InvId. Robokassa принимает номера до 2^31-1.
ALTER TABLE orders
  ADD COLUMN status_key    text,                 -- случайный ключ: страница «спасибо» узнаёт статус только своего заказа
  ADD COLUMN consent_at    timestamptz,          -- когда покупатель поставил обе галочки
  ADD COLUMN offer_version text,                 -- версия оферты и согласия на момент покупки
  ADD COLUMN test          boolean NOT NULL DEFAULT false,  -- создан в тестовом режиме Robokassa
  ADD COLUMN pay_method    text,                 -- как заплатили (из уведомления Robokassa), для админки
  ADD COLUMN fee_kop       integer,              -- комиссия Robokassa, если пришла в уведомлении
  ADD COLUMN refunded_at   timestamptz,
  ADD COLUMN status_note   text,                 -- заметка админа: почему отметили вручную или вернули деньги
  ADD COLUMN status_by     bigint REFERENCES admins(id);

CREATE INDEX orders_created_idx ON orders(created_at DESC);
CREATE INDEX orders_email_idx ON orders(email);

-- Каждое уведомление от Robokassa, в том числе отклонённое. Почту и данные карты не храним.
CREATE TABLE payment_events (
  id         bigserial PRIMARY KEY,
  order_id   bigint REFERENCES orders(id) ON DELETE SET NULL,
  inv_id     text NOT NULL,
  out_sum    text NOT NULL,
  result     text NOT NULL CHECK (result IN ('paid','repeat','bad_sign','bad_order','bad_sum','bad_status')),
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_created_idx ON payment_events(created_at DESC);

-- В журнале бывают действия без админа: оплату подтверждает сервер
-- (admin_id уже допускает NULL, это пометка для читающего)
COMMENT ON COLUMN audit_log.admin_id IS 'NULL — действие сделал сервер (например, пришла оплата)';
