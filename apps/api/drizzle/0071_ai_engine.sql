ALTER TABLE "ai_actions" ADD COLUMN "max_attempts" integer;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "report" jsonb;