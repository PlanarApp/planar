CREATE TABLE "due_reminders" (
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mark" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "due_reminders_user_id_task_id_kind_mark_pk" PRIMARY KEY("user_id","task_id","kind","mark")
);
--> statement-breakpoint
ALTER TABLE "due_reminders" ADD CONSTRAINT "due_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_reminders" ADD CONSTRAINT "due_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;