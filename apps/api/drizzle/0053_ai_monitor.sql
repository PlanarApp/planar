CREATE TABLE "ai_project_limits" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"daily_tokens" integer,
	"daily_cost" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ai_settings_one_row" CHECK ("ai_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "restart_of" uuid;