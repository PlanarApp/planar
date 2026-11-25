DROP INDEX "activity_task_id_index";--> statement-breakpoint
CREATE INDEX "activity_task_id_created_at_index" ON "activity" USING btree ("task_id","created_at");