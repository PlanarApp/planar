CREATE TABLE "workload_capacities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"hours_per_week" integer NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workload_capacities_space_user_uq" ON "workload_capacities" USING btree ("space_id","user_id");--> statement-breakpoint
CREATE INDEX "workload_capacities_space_id_idx" ON "workload_capacities" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "workload_capacities_user_id_idx" ON "workload_capacities" USING btree ("user_id");