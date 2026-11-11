CREATE TABLE "ai_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"page_id" uuid,
	"runtime" text NOT NULL,
	"model" text,
	"question_status_id" uuid,
	"checks" jsonb NOT NULL,
	"max_output_tokens" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"action_id" uuid,
	"rule_id" uuid,
	"item_id" uuid,
	"state" text NOT NULL,
	"chain_id" uuid NOT NULL,
	"chain_depth" integer NOT NULL,
	"return_status_id" uuid,
	"question_comment_ids" uuid[] DEFAULT '{}' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost" double precision,
	"log" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_actions_space_id_idx" ON "ai_actions" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_actions_project_key_uq" ON "ai_actions" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "ai_runs_task_id_idx" ON "ai_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ai_runs_state_idx" ON "ai_runs" USING btree ("state");