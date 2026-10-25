CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"every" integer NOT NULL,
	"unit" text NOT NULL,
	"weekdays" jsonb NOT NULL,
	"anchor_date" date NOT NULL,
	"next_date" date,
	"timezone" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_runs" (
	"rule_id" uuid NOT NULL,
	"period" text NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_runs_rule_id_period_pk" PRIMARY KEY("rule_id","period")
);
--> statement-breakpoint
CREATE INDEX "recurring_rules_space_id_idx" ON "recurring_rules" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_rules_task_id_uq" ON "recurring_rules" USING btree ("task_id");