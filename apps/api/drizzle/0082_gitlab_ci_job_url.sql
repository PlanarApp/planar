ALTER TABLE "gitlab_branches" ADD COLUMN "pipeline_id" integer;--> statement-breakpoint
ALTER TABLE "gitlab_branches" ADD COLUMN "pipeline_status" text;--> statement-breakpoint
ALTER TABLE "gitlab_branches" ADD COLUMN "pipeline_url" text;--> statement-breakpoint
ALTER TABLE "gitlab_mrs" ADD COLUMN "pipeline_url" text;