-- PLNRAPP-891: a project's binding to a github.com repository through a GitHub connection (as gitlab_connections)
CREATE TABLE "github_repos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"repo_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "github_repos_project_repo_uq" ON "github_repos" USING btree ("project_id","repo_id");--> statement-breakpoint
CREATE INDEX "github_repos_connection_idx" ON "github_repos" USING btree ("connection_id");