CREATE TABLE "ai_engine_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"level" text NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_engine_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"engine" text NOT NULL,
	"job" text NOT NULL,
	"project_id" uuid,
	"trigger" text NOT NULL,
	"user_id" uuid,
	"state" text NOT NULL,
	"current" text,
	"current_project_id" uuid,
	"processed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_engine_events" ADD CONSTRAINT "ai_engine_events_run_id_ai_engine_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_engine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_engine_events_run_id_idx" ON "ai_engine_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_engine_runs_started_at_idx" ON "ai_engine_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ai_engine_runs_engine_state_idx" ON "ai_engine_runs" USING btree ("engine","state");