-- Фаза 2: телефон клиента (для WhatsApp) и привязка записей журнала к клиенту.
ALTER TABLE users ADD COLUMN phone text NOT NULL DEFAULT '';

-- При удалении клиента (152-ФЗ) записи журнала остаются, но без привязки к нему
ALTER TABLE audit_log ADD COLUMN user_id bigint REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX audit_user_idx ON audit_log(user_id, created_at DESC);
