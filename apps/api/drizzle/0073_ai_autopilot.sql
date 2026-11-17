ALTER TABLE "ai_project_limits" ADD COLUMN "autopilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_project_limits" ADD COLUMN "daily_tasks" integer;