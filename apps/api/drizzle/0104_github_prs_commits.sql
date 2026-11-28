-- PLNRAPP-892: PRs and commits of bound GitHub repositories on tasks (sync entities githubPrs, githubCommits)
CREATE TABLE "github_commits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"repo_id" bigint NOT NULL,
	"repo_full_name" text NOT NULL,
	"sha" text NOT NULL,
	"message" text NOT NULL,
	"author_name" text NOT NULL,
	"web_url" text NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_prs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"repo_id" bigint NOT NULL,
	"repo_full_name" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"branch" text NOT NULL,
	"state" text NOT NULL,
	"author_login" text NOT NULL,
	"web_url" text NOT NULL,
	"pr_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_commits_task_id_idx" ON "github_commits" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_commits_uq" ON "github_commits" USING btree ("task_id","repo_id","sha");--> statement-breakpoint
CREATE INDEX "github_prs_task_id_idx" ON "github_prs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_prs_uq" ON "github_prs" USING btree ("task_id","repo_id","number");