-- PLNRAPP-890: github.com connections by level (workspace / space / project) and the level choice, as gitlab_servers / gitlab_choices;
-- the existing connection (one, of the workspace) becomes a workspace-level connection
CREATE TABLE "github_choices" (
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "scope" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "scope_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "github_connections" ALTER COLUMN "scope" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "github_connections" ALTER COLUMN "scope_id" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "github_choices_uq" ON "github_choices" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE INDEX "github_connections_scope_idx" ON "github_connections" USING btree ("scope","scope_id");
