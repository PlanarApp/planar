ALTER TABLE "ai_project_limits" ADD COLUMN "max_agents" integer;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "agent_secret_hash" text;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "container_id" text;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "started_at" timestamp with time zone;