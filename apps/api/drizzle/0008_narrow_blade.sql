CREATE TABLE "sprints_cycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprints_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"length_days" integer NOT NULL,
	"timezone" text NOT NULL,
	"auto_create" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sprints_cycles_space_id_idx" ON "sprints_cycles" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "sprints_cycles_project_id_idx" ON "sprints_cycles" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_cycles_project_number_uq" ON "sprints_cycles" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "sprints_settings_project_id_idx" ON "sprints_settings" USING btree ("project_id");