-- Материалы (гайды, видео-разборы) на сервере. Раньше жили в браузере Ники (localStorage).
-- Цена, название для чека и «показывать» живут в tariffs (kind = 'material'), здесь всё остальное.
CREATE TABLE materials (
  id          bigserial PRIMARY KEY,
  tariff_id   bigint NOT NULL UNIQUE REFERENCES tariffs(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'гайд' CHECK (length(kind) BETWEEN 1 AND 30),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 90),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  gift        boolean NOT NULL DEFAULT false,          -- открывается клиентам с сопровождением по питанию
  cover       bytea CHECK (cover IS NULL OR octet_length(cover) <= 600000),
  cover_type  text CHECK (cover_type IN ('image/jpeg','image/png','image/webp')),
  cover_url   text,                                    -- картинка из папки сайта (старые материалы)
  page_url    text,                                    -- старый материал-страница на сайте
  file_key    text,                                    -- файл в S3 (только через подписанную ссылку)
  file_name   text,
  file_type   text,
  file_size   bigint,
  pending_key text,                                    -- загрузка начата, ещё не подтверждена
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((cover IS NULL) = (cover_type IS NULL))
);

-- Уже существующие товары-материалы (на бою каталог загружен раньше этой миграции)
INSERT INTO materials (tariff_id, kind, title, cover_url, page_url)
SELECT t.id,
       CASE WHEN t.slug = 'video-alcohol' OR t.name ILIKE 'видео%' THEN 'видео-разбор' ELSE 'гайд' END,
       left(coalesce(substring(t.name from '«(.+)»'), t.name), 90),
       CASE t.slug WHEN 'guide-emotions' THEN '/assets/img/cover-guide.webp' WHEN 'video-alcohol' THEN '/assets/img/cover-video.webp' END,
       CASE t.slug WHEN 'guide-emotions' THEN '/guide-zaedanie.html' WHEN 'video-alcohol' THEN '/video-alkogol.html' END
  FROM tariffs t WHERE t.kind = 'material'
ON CONFLICT (tariff_id) DO NOTHING;
