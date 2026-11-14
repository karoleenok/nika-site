-- Пароль клиенту выдаёт админ из карточки (письма с кодом могут не ходить).
-- password_temp = true: пароль временный, кабинет просит придумать свой при первом входе.
ALTER TABLE users ADD COLUMN password_temp boolean NOT NULL DEFAULT false;
