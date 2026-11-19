ALTER TABLE "tasks" ADD COLUMN "comments_assigned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "comments_resolved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "comments_open_assignees" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "tasks" t SET
  "comments_assigned" = x.total,
  "comments_resolved" = x.resolved,
  "comments_open_assignees" = x.open
FROM (
  SELECT "task_id",
    count(*)::int AS total,
    (count(*) FILTER (WHERE "resolved_at" IS NOT NULL))::int AS resolved,
    coalesce(array_agg(DISTINCT "assignee_id" ORDER BY "assignee_id") FILTER (WHERE "resolved_at" IS NULL), '{}') AS open
  FROM "comments" WHERE "assignee_id" IS NOT NULL GROUP BY "task_id"
) x
WHERE t."id" = x."task_id";
