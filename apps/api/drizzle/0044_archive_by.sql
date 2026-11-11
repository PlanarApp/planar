ALTER TABLE "tasks" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "docs_pages" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;