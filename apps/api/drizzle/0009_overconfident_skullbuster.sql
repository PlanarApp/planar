CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	"note" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_estimates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "time_entries_space_id_idx" ON "time_entries" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "time_entries_task_id_idx" ON "time_entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "time_entries_user_id_idx" ON "time_entries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_running_uq" ON "time_entries" USING btree ("user_id") WHERE "time_entries"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "time_estimates_task_id_idx" ON "time_estimates" USING btree ("task_id");