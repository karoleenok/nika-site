-- Демо-данные только для локальной среды. Все почты на example.com (зарезервированный домен).
-- Скрипт сида запускает этот файл в транзакции и только на пустой базе.

INSERT INTO admins (email, name, role) VALUES
  ('nika@example.com',     'Ника',     'owner'),
  ('diana@example.com',    'Диана',    'staff'),
  ('karolina@example.com', 'Каролина', 'tech');

-- Цены и названия повторяют лендинг. Цена в копейках.
INSERT INTO tariffs (slug, kind, grp, name, price_kop, old_price_kop, access_days, sort) VALUES
  ('train-24h', 'access',  'Тренировки', 'Тренировки онлайн, 24 часа',  99900,   249900,  1,   1),
  ('train-1m',  'access',  'Тренировки', 'Тренировки онлайн, 1 месяц',  999900,  1279900, 28,  2),
  ('train-2m',  'access',  'Тренировки', 'Тренировки онлайн, 2 месяца', 1799900, 2499900, 56,  3),
  ('train-4m',  'access',  'Тренировки', 'Тренировки онлайн, 4 месяца', 3399900, 4279900, 112, 4),
  ('package',   'access',  'Пакет',      'Фигура под ключ', 3789900, 4799900, 56, 5);
INSERT INTO tariffs (slug, kind, grp, name, price_kop, old_price_kop, sort) VALUES
  ('food-consult', 'service',  'Питание', 'Индивидуальная консультация по питанию', 499900, 0, 10),
  ('food-labs' ,   'service',  'Питание', 'Рекомендации по составлению рациона исходя из анализов', 499900, 0, 11),
  ('food-support',  'service',  'Питание', 'Персональное сопровождение по питанию, 1 месяц', 1199900, 0, 12),
  ('video-call',   'service',  'По видеосвязи', '1 тренировка по видеосвязи', 249900, 270000, 13),
  ('guide-emotions', 'material', 'Материалы', 'Гайд «Как перестать заедать эмоции?»', 89900, 0, 20),
  ('video-alcohol',  'material', 'Материалы', 'Видео-разбор «Как не отказывать себе в алкоголе при похудении?»', 89900, 0, 21);

INSERT INTO users (email, name, note) VALUES
  ('anna@example.com',     'Анна К.',     ''),
  ('maria@example.com',    'Мария С.',    'Просила перенести созвон на субботу.'),
  ('olga@example.com',     'Ольга В.',    ''),
  ('elena@example.com',    'Елена Т.',    'Колено, без прыжков.'),
  ('viktoria@example.com', 'Виктория Б.', ''),
  ('polina@example.com',   'Полина Д.',   '');

-- Разные тарифы и сроки: закончился, заканчивается через 2 и 6 дней, действует, 24 часа, закрыт вручную
INSERT INTO access_periods (user_id, tariff_id, starts_at, ends_at, source)
SELECT u.id, t.id, now() + (d.end_days - t.access_days) * interval '1 day', now() + d.end_days * interval '1 day', 'manual'
FROM (VALUES ('anna@example.com','train-2m',-5), ('maria@example.com','train-1m',2),
             ('olga@example.com','package',6),   ('elena@example.com','train-4m',40),
             ('polina@example.com','train-24h',1), ('viktoria@example.com','train-1m',10)) AS d(email, slug, end_days)
JOIN users u ON u.email = d.email JOIN tariffs t ON t.slug = d.slug;
UPDATE access_periods SET closed_at = now(), close_note = 'Демо: доступ закрыт вручную'
WHERE user_id = (SELECT id FROM users WHERE email = 'viktoria@example.com');

-- Оплаты для блока «Новые покупки» и вкладки «Оплаты» в карточке
INSERT INTO orders (user_id, email, tariff_id, item_name, amount_kop, status, paid_at)
SELECT u.id, u.email, t.id, 'Тариф «' || t.name || '»', t.price_kop, 'paid', now() - d.ago
FROM (VALUES ('maria@example.com','train-1m', interval '2 hours'), ('olga@example.com','package', interval '1 day'),
             ('anna@example.com','train-2m', interval '40 days')) AS d(email, slug, ago)
JOIN users u ON u.email = d.email JOIN tariffs t ON t.slug = d.slug;

INSERT INTO purchases (user_id, tariff_id)
SELECT u.id, t.id FROM users u, tariffs t WHERE u.email = 'anna@example.com' AND t.slug = 'guide-emotions';

-- Группы тренировок (как папки на Диске Ники) и 5 готовых видео.
-- Файлы кладёт в хранилище скрипт сида (server/seed/videos/demo-N.mp4), он же пишет размер.
INSERT INTO video_groups (name, sort) VALUES
  ('Грудь/руки', 1), ('Ноги', 2), ('Плиометрика', 3), ('Пресс', 4), ('Разминка', 5), ('Спина', 6);
INSERT INTO videos (title, group_id, description, gear, sort, s3_key, size_bytes, status, published)
SELECT v.title, g.id, v.descr, v.gear, v.sort, v.key, 0, 'ready', true
  FROM (VALUES
    ('Приседания: техника и дыхание', 'Ноги',     'Постановка стоп, глубина и положение корпуса.', ARRAY['коврик'],          1, 'video/demo-1.mp4'),
    ('Ягодичный мостик',              'Ноги',     'Нужные мышцы без нагрузки на поясницу.',        ARRAY['коврик'],          2, 'video/demo-2.mp4'),
    ('Тяга резинки к поясу',          'Спина',    'Чувствуем лопатки, без рывков.',                ARRAY['длинная резинка'], 1, 'video/demo-3.mp4'),
    ('Планка: три варианта',          'Пресс',    'От планки на коленях до боковой.',              ARRAY['коврик'],          1, 'video/demo-4.mp4'),
    ('Разминка перед тренировкой',    'Разминка', 'Разогреть суставы и мышцы.',                    ARRAY['коврик'],          1, 'video/demo-5.mp4')
  ) AS v(title, grp, descr, gear, sort, key)
  JOIN video_groups g ON g.name = v.grp;

INSERT INTO leads (name, contact, service, message, consent_at, is_new) VALUES
  ('Кристина', 'demo-tg-kristina', 'Сопровождение', 'Хочу понять, с чего начать.', now(), true),
  ('Вероника', 'veronika@example.com', 'Тренировки 2 месяца', 'Интересует онлайн-сопровождение.', now() - interval '1 day', true);
