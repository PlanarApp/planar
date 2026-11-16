ALTER TABLE "ai_runs" ADD COLUMN "page_id" uuid;--> statement-breakpoint
CREATE INDEX "ai_runs_page_id_item_id_state_idx" ON "ai_runs" USING btree ("page_id","item_id","state");--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_target_check" CHECK ("ai_runs"."task_id" is null or "ai_runs"."page_id" is null);