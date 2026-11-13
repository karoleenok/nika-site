-- Фаза 3: видео на сервере.
-- Группы тренировок теперь в базе (раньше жили в браузере Ники).
CREATE TABLE video_groups (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  visible    boolean NOT NULL DEFAULT true,
  sort       int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX video_groups_name ON video_groups (lower(name));

-- Если в базе уже были видео с группой-словом (сид фазы 0), переносим их в группы
INSERT INTO video_groups (name, sort)
SELECT CASE g WHEN 'chest' THEN 'Грудь/руки' WHEN 'legs' THEN 'Ноги' WHEN 'plyo' THEN 'Плиометрика'
              WHEN 'abs' THEN 'Пресс' WHEN 'warmup' THEN 'Разминка' WHEN 'back' THEN 'Спина' ELSE g END,
       row_number() OVER (ORDER BY g)
  FROM (SELECT DISTINCT muscle_group AS g FROM videos) s;

ALTER TABLE videos ADD COLUMN group_id bigint REFERENCES video_groups(id) ON DELETE RESTRICT;
UPDATE videos v SET group_id = g.id FROM video_groups g
 WHERE g.name = CASE v.muscle_group WHEN 'chest' THEN 'Грудь/руки' WHEN 'legs' THEN 'Ноги' WHEN 'plyo' THEN 'Плиометрика'
                 WHEN 'abs' THEN 'Пресс' WHEN 'warmup' THEN 'Разминка' WHEN 'back' THEN 'Спина' ELSE v.muscle_group END;
ALTER TABLE videos ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE videos DROP COLUMN muscle_group;

ALTER TABLE videos ADD COLUMN gear text[] NOT NULL DEFAULT '{}';
ALTER TABLE videos ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- empty: карточка есть, файла ещё нет. Опубликовать можно только готовое.
ALTER TABLE videos DROP CONSTRAINT videos_status_check;
ALTER TABLE videos ALTER COLUMN status SET DEFAULT 'empty';
ALTER TABLE videos ADD CONSTRAINT videos_status_check CHECK (status IN ('empty','uploading','ready','failed'));
ALTER TABLE videos ADD CONSTRAINT videos_publish_ready CHECK (NOT published OR status = 'ready');
CREATE INDEX videos_group ON videos (group_id, sort, id);

-- Загрузка частями: сколько частей ждём и «отпечаток» файла, чтобы продолжить с того же места
ALTER TABLE uploads ADD COLUMN part_size int NOT NULL DEFAULT 10485760;
ALTER TABLE uploads ADD COLUMN part_count int NOT NULL DEFAULT 1 CHECK (part_count BETWEEN 1 AND 10000);
ALTER TABLE uploads ADD COLUMN file_fp text NOT NULL DEFAULT '';
ALTER TABLE uploads ADD COLUMN finished_at timestamptz;
CREATE UNIQUE INDEX uploads_one_active ON uploads (video_id) WHERE status = 'active';
