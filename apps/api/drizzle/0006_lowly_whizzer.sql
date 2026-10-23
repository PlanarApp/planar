CREATE TABLE "field_defs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb NOT NULL,
	"rank" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_defs_type_check" CHECK ("field_defs"."type" in ('text', 'number', 'date', 'select', 'user', 'url', 'money'))
);
--> statement-breakpoint
CREATE TABLE "task_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_links_kind_check" CHECK ("task_links"."kind" in ('blocks', 'relates', 'duplicates')),
	CONSTRAINT "task_links_self_check" CHECK ("task_links"."task_id" <> "task_links"."target_id")
);
--> statement-breakpoint
ALTER TABLE "field_defs" ADD CONSTRAINT "field_defs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_defs" ADD CONSTRAINT "field_defs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_target_id_tasks_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_defs_space_id_index" ON "field_defs" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "field_defs_project_id_index" ON "field_defs" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_links_pair_uq" ON "task_links" USING btree (least("task_id", "target_id"),greatest("task_id", "target_id"));--> statement-breakpoint
CREATE INDEX "task_links_task_id_index" ON "task_links" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_links_target_id_index" ON "task_links" USING btree ("target_id");