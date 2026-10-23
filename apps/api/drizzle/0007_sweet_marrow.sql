ALTER TABLE "tasks" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
CREATE INDEX "tasks_cycle_id_index" ON "tasks" USING btree ("cycle_id");