CREATE TABLE "ai_retro" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"every_frictions" integer DEFAULT 5 NOT NULL,
	"every_days" integer DEFAULT 7 NOT NULL,
	"task_id" uuid,
	"frictions" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_retro_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"assignee_id" uuid,
	"action_key" text NOT NULL,
	"page_id" uuid,
	"base" text NOT NULL,
	"prompt" text NOT NULL,
	"new_action" jsonb,
	"title" text NOT NULL,
	"items" uuid[] DEFAULT '{}' NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_retro_proposals" ADD CONSTRAINT "ai_retro_proposals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_retro_proposals_project_id_idx" ON "ai_retro_proposals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_retro_proposals_comment_id_idx" ON "ai_retro_proposals" USING btree ("comment_id");
