-- PLNRAPP-241: модуль ai включается и в воркспейсе (settings.enabled_modules), и в проекте; работает при обоих.
-- Если ai включён хотя бы в одном проекте — включаем его в воркспейсе, чтобы ничего не выключилось.
-- Доставка клиентам — глобальная строка changes `_reset` (как в 0033).
INSERT INTO "settings" (id, value, updated_at)
SELECT 'enabled_modules', '["ai"]'::jsonb, now()
WHERE EXISTS (SELECT 1 FROM "projects" WHERE 'ai' = ANY ("modules"))
ON CONFLICT (id) DO UPDATE SET
  value = CASE
    WHEN jsonb_typeof("settings".value) = 'array' THEN "settings".value || '["ai"]'::jsonb
    ELSE '["ai"]'::jsonb
  END,
  updated_at = now()
WHERE NOT (jsonb_typeof("settings".value) = 'array' AND "settings".value ? 'ai');--> statement-breakpoint
INSERT INTO "changes" (entity, id, op)
SELECT '_reset', 'plnrapp-241-ai-workspace', 'put'
WHERE EXISTS (SELECT 1 FROM "projects" WHERE 'ai' = ANY ("modules"));
