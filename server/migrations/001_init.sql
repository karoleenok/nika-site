-- Схема базы. Время хранится в UTC (timestamptz), деньги в копейках (integer).
-- Транзакцию открывает скрипт миграций (server/scripts/migrate.js).

CREATE EXTENSION IF NOT EXISTS citext;

-- Клиенты
CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  email         citext NOT NULL UNIQUE,
  name          text   NOT NULL DEFAULT '',
  password_hash text,                       -- необязательный пароль (argon2id); NULL = входит только по коду
  note          text   NOT NULL DEFAULT '', -- заметка Ники о клиенте
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Админы. role: owner (Ника, видит всё), staff (Диана), tech (Каролина: + журнал)
CREATE TABLE admins (
  id         bigserial PRIMARY KEY,
  email      citext NOT NULL UNIQUE,
  name       text   NOT NULL,
  role       text   NOT NULL CHECK (role IN ('owner','staff','tech')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Сессии: в куке лежит случайный токен, в базе только его хеш
CREATE TABLE sessions (
  id           bigserial PRIMARY KEY,
  token_hash   bytea NOT NULL UNIQUE,
  user_id      bigint REFERENCES users(id)  ON DELETE CASCADE,
  admin_id     bigint REFERENCES admins(id) ON DELETE CASCADE,
  persistent   boolean NOT NULL,            -- «запомнить меня»
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (admin_id IS NULL))
);
CREATE INDEX sessions_user_idx  ON sessions(user_id);
CREATE INDEX sessions_admin_idx ON sessions(admin_id);

-- Коды из письма: 6 цифр, 10 минут, одноразовые, до 5 попыток
CREATE TABLE login_codes (
  id         bigserial PRIMARY KEY,
  email      citext NOT NULL,
  kind       text   NOT NULL CHECK (kind IN ('user','admin')),
  code_hash  bytea  NOT NULL,
  attempts   int    NOT NULL DEFAULT 0,
  used_at    timestamptz,
  expires_at timestamptz NOT NULL,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_codes_email_idx ON login_codes(email, created_at DESC);
CREATE INDEX login_codes_ip_idx    ON login_codes(ip, created_at DESC);

-- Ссылки из письма: 32+ байта, 15 минут, одноразовые
CREATE TABLE login_tokens (
  id         bigserial PRIMARY KEY,
  token_hash bytea  NOT NULL UNIQUE,
  email      citext NOT NULL,
  kind       text   NOT NULL CHECK (kind IN ('user','admin')),
  used_at    timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Товары. kind: access (тариф со сроком), material (гайд/видеоразбор навсегда), service (услуга, только заказ)
-- Срок доступа хранится в днях: недели × 7, а «24 часа» = 1 день. В интерфейсе показываем недели.
CREATE TABLE tariffs (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  kind         text NOT NULL CHECK (kind IN ('access','material','service')),
  grp          text NOT NULL DEFAULT '',
  name         text NOT NULL,
  price_kop    integer NOT NULL CHECK (price_kop >= 0),
  old_price_kop integer NOT NULL DEFAULT 0,
  access_days  integer CHECK (access_days > 0),
  sort         int NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  CHECK ((kind = 'access') = (access_days IS NOT NULL))
);

-- Заказы
CREATE TABLE orders (
  id          bigserial PRIMARY KEY,           -- он же InvId для Robokassa
  user_id     bigint REFERENCES users(id),
  email       citext NOT NULL,
  tariff_id   bigint NOT NULL REFERENCES tariffs(id),
  item_name   text   NOT NULL,                 -- название на момент покупки (для чека)
  amount_kop  integer NOT NULL CHECK (amount_kop > 0),
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','paid','failed','refunded','manual')),
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx ON orders(user_id);

-- Периоды доступа. Действующий доступ = есть период, где сейчас между starts_at и ends_at и не закрыт.
CREATE TABLE access_periods (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tariff_id  bigint REFERENCES tariffs(id),
  order_id   bigint UNIQUE REFERENCES orders(id), -- UNIQUE: одна оплата не продлевает доступ дважды
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL CHECK (ends_at > starts_at),
  source     text NOT NULL CHECK (source IN ('payment','manual','extend')),
  closed_at  timestamptz,
  close_note text,
  created_by bigint REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_user_idx ON access_periods(user_id, ends_at DESC);

-- Купленные материалы (навсегда)
CREATE TABLE purchases (
  id        bigserial PRIMARY KEY,
  user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tariff_id bigint NOT NULL REFERENCES tariffs(id),
  order_id  bigint UNIQUE REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tariff_id)
);

-- Видео
CREATE TABLE videos (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL,
  muscle_group text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort        int  NOT NULL DEFAULT 0,
  s3_key      text UNIQUE,
  size_bytes  bigint,
  status      text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready','failed')),
  published   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Загрузки частями
CREATE TABLE uploads (
  id          bigserial PRIMARY KEY,
  video_id    bigint NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  s3_upload_id text NOT NULL,
  s3_key      text NOT NULL,
  size_bytes  bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2147483648),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','aborted','failed')),
  created_by  bigint REFERENCES admins(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Заявки с лендинга
CREATE TABLE leads (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL,
  contact    text NOT NULL,
  service    text NOT NULL DEFAULT '',
  message    text NOT NULL DEFAULT '',
  consent_at timestamptz NOT NULL,
  is_new     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Анкета о здоровье: отдельная таблица, видит только owner
CREATE TABLE questionnaires (
  id              bigserial PRIMARY KEY,
  user_id         bigint REFERENCES users(id) ON DELETE CASCADE,
  lead_id         bigint REFERENCES leads(id) ON DELETE CASCADE,
  answers         jsonb NOT NULL,
  consent_at      timestamptz NOT NULL,
  consent_version text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR lead_id IS NOT NULL)
);

-- Журнал действий админки
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  admin_id   bigint REFERENCES admins(id),
  action     text NOT NULL,
  target     text,
  note       text,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_log(created_at DESC);
