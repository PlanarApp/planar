CREATE TABLE "automations_due_fired" (
	"rule_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	CONSTRAINT "automations_due_fired_rule_id_task_id_due_date_pk" PRIMARY KEY("rule_id","task_id","due_date")
);
--> statement-breakpoint
CREATE TABLE "automations_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_runs_status_check" CHECK ("automations_runs"."status" in ('ok', 'skipped', 'error'))
);
--> statement-breakpoint
CREATE INDEX "automations_rules_space_id_idx" ON "automations_rules" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "automations_rules_project_id_idx" ON "automations_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "automations_runs_rule_idx" ON "automations_runs" USING btree ("rule_id","created_at" DESC NULLS LAST);