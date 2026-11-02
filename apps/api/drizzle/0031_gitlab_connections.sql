CREATE TABLE "gitlab_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"base_url" text NOT NULL,
	"token_enc" text NOT NULL,
	"gitlab_project_id" integer NOT NULL,
	"path" text NOT NULL,
	"cursor" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gitlab_connections_project_repo_uq" ON "gitlab_connections" USING btree ("project_id","gitlab_project_id");--> statement-breakpoint
-- the workspace connection goes to every project that already has MRs from the repository
INSERT INTO "gitlab_connections" ("id", "project_id", "base_url", "token_enc", "gitlab_project_id", "path", "cursor", "last_polled_at", "created_at")
SELECT gen_random_uuid(), x.project_id, c.base_url, c.token_enc, p.gitlab_project_id, p.path, p.cursor, p.last_polled_at, p.created_at
FROM "gitlab_projects" p
JOIN "gitlab_config" c ON c.id = 'default' AND c.token_enc IS NOT NULL
JOIN (SELECT DISTINCT t.project_id, m.gitlab_project_id FROM "gitlab_mrs" m JOIN "tasks" t ON t.id = m.task_id) x
  ON x.gitlab_project_id = p.gitlab_project_id;--> statement-breakpoint
DROP TABLE "gitlab_config" CASCADE;--> statement-breakpoint
DROP TABLE "gitlab_projects" CASCADE;