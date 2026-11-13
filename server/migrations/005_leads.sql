-- Фаза 5: заявки с лендинга и анкета по витаминам и анализам.
-- Таблицы leads и questionnaires созданы в 001, здесь — то, чего не хватало.

ALTER TABLE leads
  ADD COLUMN source          text NOT NULL DEFAULT 'site' CHECK (source IN ('site','test')),
  ADD COLUMN consent_version text,                      -- версия текста согласия на обработку ПД
  ADD COLUMN quiz_key_hash   text,                      -- хеш одноразового ключа: анкету можно привязать только к своей заявке
  ADD COLUMN quiz_key_until  timestamptz,
  ADD COLUMN done_at         timestamptz,
  ADD COLUMN done_by         bigint REFERENCES admins(id);
CREATE INDEX leads_created_idx ON leads(created_at DESC);
CREATE INDEX leads_new_idx ON leads(is_new) WHERE is_new;
CREATE UNIQUE INDEX leads_quiz_key_idx ON leads(quiz_key_hash) WHERE quiz_key_hash IS NOT NULL;

ALTER TABLE questionnaires
  ADD COLUMN form_version text NOT NULL DEFAULT '',     -- какой набор вопросов видел человек
  ADD COLUMN analyses     jsonb NOT NULL DEFAULT '[]';  -- предварительный список анализов (посчитал сервер)
CREATE UNIQUE INDEX questionnaires_lead_idx ON questionnaires(lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON TABLE questionnaires IS 'Данные о здоровье. Читает только owner, каждый просмотр пишется в audit_log';
