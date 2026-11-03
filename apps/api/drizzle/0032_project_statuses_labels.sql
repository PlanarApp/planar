-- PJ-1: статусы и метки принадлежат проекту (decision 2.2, docs/contracts/projects.md).
-- Каждый проект пространства получает копии всех статусов и меток пространства; задачи, связи меток и ссылки
-- модулей перепривязываются по карте (старый id, проект) -> новый id; оригиналы пространства удаляются.
-- Доставка клиентам: в конце пишется глобальная строка changes `_reset` -> каждый клиент на ближайшем pull
-- получает reset и заново грузит bootstrap (поштучные put/del для statuses/labels/tasks/task_labels не нужны).
ALTER TABLE "labels" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN "project_id" uuid;--> statement-breakpoint
CREATE TEMP TABLE "_pj1_map" AS
SELECT s.id AS old_id, p.id AS project_id, gen_random_uuid() AS new_id
FROM "statuses" s JOIN "projects" p ON p.space_id = s.space_id
UNION ALL
SELECT l.id, p.id, gen_random_uuid()
FROM "labels" l JOIN "projects" p ON p.space_id = l.space_id;--> statement-breakpoint
CREATE INDEX ON "_pj1_map" (old_id, project_id);--> statement-breakpoint
INSERT INTO "statuses" (id, space_id, project_id, name, category, color, rank, created_at, updated_at)
SELECT m.new_id, s.space_id, m.project_id, s.name, s.category, s.color, s.rank, s.created_at, s.updated_at
FROM "_pj1_map" m JOIN "statuses" s ON s.id = m.old_id;--> statement-breakpoint
INSERT INTO "labels" (id, space_id, project_id, name, color, created_at, updated_at)
SELECT m.new_id, l.space_id, m.project_id, l.name, l.color, l.created_at, l.updated_at
FROM "_pj1_map" m JOIN "labels" l ON l.id = m.old_id;--> statement-breakpoint
CREATE FUNCTION pg_temp.pj1_new(old text, pid uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce((SELECT new_id::text FROM "_pj1_map" WHERE old_id::text = old AND project_id = pid LIMIT 1), old)
$$;--> statement-breakpoint
CREATE FUNCTION pg_temp.pj1_json(j jsonb, pid uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t text := j::text; m record;
BEGIN
  FOR m IN SELECT old_id, new_id FROM "_pj1_map" WHERE project_id = pid LOOP
    t := replace(t, m.old_id::text, m.new_id::text);
  END LOOP;
  RETURN t::jsonb;
END $$;--> statement-breakpoint
UPDATE "tasks" t SET status_id = m.new_id FROM "_pj1_map" m WHERE m.old_id = t.status_id AND m.project_id = t.project_id;--> statement-breakpoint
UPDATE "task_labels" tl SET label_id = m.new_id FROM "_pj1_map" m, "tasks" t
WHERE t.id = tl.task_id AND m.old_id = tl.label_id AND m.project_id = t.project_id;--> statement-breakpoint
UPDATE "gitlab_project_settings" g SET merged_status_id = (SELECT m.new_id FROM "_pj1_map" m WHERE m.old_id = g.merged_status_id AND m.project_id = g.id)
WHERE g.merged_status_id IS NOT NULL;--> statement-breakpoint
UPDATE "forms_forms" f SET status_id = m.new_id FROM "_pj1_map" m WHERE m.old_id = f.status_id AND m.project_id = f.project_id;--> statement-breakpoint
UPDATE "import_jobs" j SET mapping = pg_temp.pj1_json(j.mapping, j.project_id) WHERE j.mapping IS NOT NULL;--> statement-breakpoint
-- правила автоматизаций: id статусов и меток — в триггере, условиях и действиях; move_to_project.statusId — статус целевого проекта
UPDATE "automations_rules" r SET
  trigger = pg_temp.pj1_json(r.trigger, r.project_id),
  conditions = pg_temp.pj1_json(r.conditions, r.project_id),
  actions = CASE WHEN jsonb_typeof(r.actions) = 'array' THEN (
    SELECT coalesce(jsonb_agg(CASE
      WHEN e ->> 'type' = 'move_to_project' AND e ? 'statusId' THEN pg_temp.pj1_json(e, (e ->> 'projectId')::uuid)
      ELSE pg_temp.pj1_json(e, r.project_id) END), '[]'::jsonb)
    FROM jsonb_array_elements(r.actions) e) ELSE pg_temp.pj1_json(r.actions, r.project_id) END;--> statement-breakpoint
-- сохранённые виды: фильтр по статусам/меткам пространства -> копии этого статуса/метки во всех проектах пространства
UPDATE "saved_views" v SET filter = jsonb_set(v.filter, '{rules}', (
  SELECT coalesce(jsonb_agg(CASE
    WHEN r ->> 'field' IN ('status', 'label') AND jsonb_typeof(r -> 'value') = 'array' THEN jsonb_set(r, '{value}', (
      SELECT coalesce(jsonb_agg(DISTINCT to_jsonb(coalesce(m.new_id::text, x))), '[]'::jsonb)
      FROM jsonb_array_elements_text(r -> 'value') x LEFT JOIN "_pj1_map" m ON m.old_id::text = x))
    ELSE r END), '[]'::jsonb)
  FROM jsonb_array_elements(v.filter -> 'rules') r))
WHERE jsonb_typeof(v.filter -> 'rules') = 'array';--> statement-breakpoint
-- журнал и уведомления: id статуса/метки в changes по проекту задачи
UPDATE "activity" a SET changes = jsonb_set(a.changes, '{statusId}', jsonb_build_array(
  pg_temp.pj1_new(a.changes -> 'statusId' ->> 0, t.project_id), pg_temp.pj1_new(a.changes -> 'statusId' ->> 1, t.project_id)))
FROM "tasks" t WHERE t.id = a.task_id AND jsonb_typeof(a.changes -> 'statusId') = 'array';--> statement-breakpoint
UPDATE "activity" a SET changes = jsonb_set(a.changes, '{labelId}', to_jsonb(pg_temp.pj1_new(a.changes ->> 'labelId', t.project_id)))
FROM "tasks" t WHERE t.id = a.task_id AND jsonb_typeof(a.changes -> 'labelId') = 'string';--> statement-breakpoint
UPDATE "notifications" n SET changes = jsonb_set(n.changes, '{statusId}', jsonb_build_array(
  pg_temp.pj1_new(n.changes -> 'statusId' ->> 0, t.project_id), pg_temp.pj1_new(n.changes -> 'statusId' ->> 1, t.project_id)))
FROM "tasks" t WHERE t.id = n.task_id AND jsonb_typeof(n.changes -> 'statusId') = 'array';--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "tasks" t JOIN "statuses" s ON s.id = t.status_id WHERE s.project_id IS DISTINCT FROM t.project_id) THEN
    RAISE EXCEPTION 'PJ-1: у задачи нет копии статуса в её проекте';
  END IF;
  IF EXISTS (SELECT 1 FROM "task_labels" tl JOIN "tasks" t ON t.id = tl.task_id JOIN "labels" l ON l.id = tl.label_id WHERE l.project_id IS DISTINCT FROM t.project_id) THEN
    RAISE EXCEPTION 'PJ-1: у связи метки нет копии метки в проекте задачи';
  END IF;
  IF EXISTS (SELECT 1 FROM "forms_forms" f WHERE NOT EXISTS (SELECT 1 FROM "statuses" s WHERE s.id = f.status_id AND s.project_id = f.project_id)) THEN
    RAISE EXCEPTION 'PJ-1: у формы нет статуса в её проекте';
  END IF;
END $$;--> statement-breakpoint
DELETE FROM "statuses" WHERE project_id IS NULL;--> statement-breakpoint
DELETE FROM "labels" WHERE project_id IS NULL;--> statement-breakpoint
DROP TABLE "_pj1_map";--> statement-breakpoint
ALTER TABLE "labels" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "statuses" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "labels_project_id_index" ON "labels" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "statuses_project_id_index" ON "statuses" USING btree ("project_id");--> statement-breakpoint
INSERT INTO "changes" (entity, id, op) VALUES ('_reset', 'pj-1-project-dictionaries', 'put');
