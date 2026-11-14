-- Настройки сайта, которые Ника меняет из админки (ключ → значение).
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- videos_soon: уроки, которые ещё не опубликованы, видны клиентам с меткой «скоро» (без файла и описания).
INSERT INTO settings (key, value) VALUES ('videos_soon', 'true');
