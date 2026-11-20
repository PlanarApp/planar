-- PLNRAPP-708: the «My day» plan date (day_plans.date) -> tasks.due_date where due_date is empty.
-- A task may have several plan rows (several users, carried-over days): the latest date wins.
-- A filled due_date is never touched; a repeated run updates nothing (WHERE due_date IS NULL).
-- day_plans is kept. Clients get the new due dates with a re-bootstrap (_reset, as in 0035, 0065) —
-- only when something was updated.
WITH "plan" AS (
  SELECT "task_id", max("date") AS "date" FROM "day_plans" GROUP BY "task_id"
), "upd" AS (
  UPDATE "tasks" t SET "due_date" = p."date", "updated_at" = now()
  FROM "plan" p
  WHERE t."id" = p."task_id" AND t."due_date" IS NULL
  RETURNING t."id"
)
INSERT INTO "changes" (entity, id, op)
SELECT '_reset', 'plnrapp-708-day-plan-due-date', 'put'
WHERE EXISTS (SELECT 1 FROM "upd");
