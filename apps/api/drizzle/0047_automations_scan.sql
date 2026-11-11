CREATE TABLE "automations_fired" (
	"rule_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_fired_rule_id_task_id_slot_pk" PRIMARY KEY("rule_id","task_id","slot")
);
--> statement-breakpoint
ALTER TABLE "automations_rules" ADD COLUMN "description" text;