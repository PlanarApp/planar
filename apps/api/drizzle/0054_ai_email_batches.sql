CREATE TABLE "ai_email_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"state" text NOT NULL,
	"emails" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_email_batches" ADD CONSTRAINT "ai_email_batches_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_email_batches_comment_id_idx" ON "ai_email_batches" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "ai_email_batches_project_id_idx" ON "ai_email_batches" USING btree ("project_id");