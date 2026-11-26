CREATE TABLE "gitlab_choices" (
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"server_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_servers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"token_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gitlab_connections" ADD COLUMN "server_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "gitlab_choices_uq" ON "gitlab_choices" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE INDEX "gitlab_servers_scope_idx" ON "gitlab_servers" USING btree ("scope","scope_id");--> statement-breakpoint
-- data: every distinct (host, token) of the old per-project connections -> a workspace connection (the oldest is the default)
INSERT INTO "gitlab_servers" ("id", "scope", "scope_id", "name", "base_url", "token_enc", "created_at")
SELECT gen_random_uuid(), 'workspace', '00000000-0000-0000-0000-000000000000',
       regexp_replace(g.base_url, '^https?://', '') || ' #' || row_number() OVER (ORDER BY g.at, g.base_url, g.token_enc),
       g.base_url, g.token_enc, g.at
FROM (SELECT base_url, token_enc, min(created_at) AS at FROM "gitlab_connections" GROUP BY base_url, token_enc) g;--> statement-breakpoint
UPDATE "gitlab_connections" c SET "server_id" = s.id
FROM "gitlab_servers" s WHERE s.base_url = c.base_url AND s.token_enc = c.token_enc;--> statement-breakpoint
-- a project whose connection is not the default one keeps it by its own choice
INSERT INTO "gitlab_choices" ("scope", "scope_id", "server_id")
SELECT DISTINCT ON (c.project_id) 'project', c.project_id, c.server_id
FROM "gitlab_connections" c
WHERE c.server_id <> (SELECT id FROM "gitlab_servers" ORDER BY created_at, id LIMIT 1)
ORDER BY c.project_id, c.created_at, c.id;--> statement-breakpoint
ALTER TABLE "gitlab_connections" ALTER COLUMN "server_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gitlab_connections" DROP COLUMN "base_url";--> statement-breakpoint
ALTER TABLE "gitlab_connections" DROP COLUMN "token_enc";
