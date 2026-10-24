CREATE TABLE "forms_forms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"fields" jsonb NOT NULL,
	"status_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "forms_forms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "forms_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "forms_forms_space_id_idx" ON "forms_forms" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "forms_forms_project_id_idx" ON "forms_forms" USING btree ("project_id");