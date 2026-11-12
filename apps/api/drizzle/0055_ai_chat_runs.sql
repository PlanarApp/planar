ALTER TABLE "ai_runs" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "channel_id" uuid;
