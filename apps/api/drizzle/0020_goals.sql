CREATE TABLE "goals_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" uuid,
	"due_date" date,
	"rank" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals_key_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"metric" jsonb,
	"filter" jsonb,
	"rank" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals_milestone_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "goals_goals_space_id_idx" ON "goals_goals" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "goals_key_results_goal_id_idx" ON "goals_key_results" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goals_milestone_tasks_milestone_id_idx" ON "goals_milestone_tasks" USING btree ("milestone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goals_milestone_tasks_task_id_uq" ON "goals_milestone_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "goals_milestones_space_id_idx" ON "goals_milestones" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "goals_milestones_project_id_idx" ON "goals_milestones" USING btree ("project_id");