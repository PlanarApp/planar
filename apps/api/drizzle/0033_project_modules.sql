-- PJ-3: модули данных включаются по проектам (docs/contracts/projects.md, C-schema v16).
-- Модуль данных, включённый для экземпляра (settings.enabled_modules), включается во всех существующих проектах
-- (в том числе архивных); id модулей данных убираются из enabled_modules (там остаются только общие модули).
-- Доставка клиентам: в конце пишется глобальная строка changes `_reset` -> каждый клиент на ближайшем pull
-- получает reset и заново грузит bootstrap (изменены все проекты и строка settings; поштучные put не нужны).
ALTER TABLE "projects" ADD COLUMN "modules" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "projects" SET "modules" = coalesce((
  SELECT array_agg(v ORDER BY o)
  FROM jsonb_array_elements_text((SELECT value FROM "settings" WHERE id = 'enabled_modules' AND jsonb_typeof(value) = 'array')) WITH ORDINALITY AS e(v, o)
  WHERE v = ANY (ARRAY['gitlab','sprints','time','forms','recurring','automations','templates','goals','timeline','workload','dashboards','docs'])
), '{}');--> statement-breakpoint
UPDATE "settings" SET
  value = coalesce((
    SELECT jsonb_agg(e.v ORDER BY e.o)
    FROM jsonb_array_elements(value) WITH ORDINALITY AS e(v, o)
    WHERE (e.v #>> '{}') <> ALL (ARRAY['gitlab','sprints','time','forms','recurring','automations','templates','goals','timeline','workload','dashboards','docs'])
  ), '[]'::jsonb),
  updated_at = now()
WHERE id = 'enabled_modules' AND jsonb_typeof(value) = 'array';--> statement-breakpoint
INSERT INTO "changes" (entity, id, op) VALUES ('_reset', 'pj-3-project-modules', 'put');
