CREATE TABLE "gitlab_branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"gitlab_project_id" integer NOT NULL,
	"name" text NOT NULL,
	"web_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gitlab_project_settings" ADD COLUMN "branch_template" text;--> statement-breakpoint
CREATE INDEX "gitlab_branches_task_id_idx" ON "gitlab_branches" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gitlab_branches_uq" ON "gitlab_branches" USING btree ("task_id","gitlab_project_id","name");