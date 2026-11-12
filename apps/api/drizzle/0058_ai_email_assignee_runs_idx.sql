ALTER TABLE "ai_email_batches" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
CREATE INDEX "ai_runs_project_id_created_at_idx" ON "ai_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_created_at_idx" ON "ai_runs" USING btree ("created_at");