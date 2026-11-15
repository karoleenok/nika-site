-- «Посмотреть как клиент»: сессия кабинета, которую открыл админ. Только чтение, 1 час, без продления.
ALTER TABLE sessions ADD COLUMN viewer_admin_id bigint REFERENCES admins(id) ON DELETE CASCADE;
