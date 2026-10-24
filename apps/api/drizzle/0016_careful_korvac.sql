CREATE TABLE "gitlab_config" (
	"id" text PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"token_enc" text,
	"interval_sec" integer DEFAULT 120 NOT NULL,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_mrs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"gitlab_project_id" integer NOT NULL,
	"iid" integer NOT NULL,
	"title" text NOT NULL,
	"source_branch" text NOT NULL,
	"state" text NOT NULL,
	"author_name" text NOT NULL,
	"web_url" text NOT NULL,
	"mr_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_project_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"merged_status_id" uuid,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gitlab_project_id" integer NOT NULL,
	"path" text NOT NULL,
	"cursor" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gitlab_projects_gitlabProjectId_unique" UNIQUE("gitlab_project_id")
);
--> statement-breakpoint
CREATE INDEX "gitlab_mrs_task_id_idx" ON "gitlab_mrs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gitlab_mrs_mr_uq" ON "gitlab_mrs" USING btree ("task_id","gitlab_project_id","iid");--> statement-breakpoint
CREATE INDEX "gitlab_project_settings_space_id_idx" ON "gitlab_project_settings" USING btree ("space_id");