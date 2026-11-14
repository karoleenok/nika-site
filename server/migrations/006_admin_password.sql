-- Вход в админку по почте и паролю. Хеш argon2id; NULL = пароля нет, вход только по коду из письма.
ALTER TABLE admins ADD COLUMN password_hash text;
