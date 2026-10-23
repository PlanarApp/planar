CREATE TABLE "chat_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid,
	"kind" text NOT NULL,
	"name" text,
	"topic" text,
	"created_by" uuid NOT NULL,
	"last_seq" integer NOT NULL,
	"last_message_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid,
	"channel_id" uuid NOT NULL,
	"parent_id" uuid,
	"seq" integer,
	"author_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"mentions" jsonb NOT NULL,
	"attachments" jsonb NOT NULL,
	"reply_count" integer NOT NULL,
	"last_reply_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_reactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid,
	"channel_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_reads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"last_read_seq" integer NOT NULL,
	"muted" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs_locks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"rank" text COLLATE "C" NOT NULL,
	"title" text NOT NULL,
	"icon" text,
	"body" jsonb NOT NULL,
	"text" text NOT NULL,
	"files" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs_task_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "space_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_parent_id_chat_messages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."chat_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_channels_space_id_idx" ON "chat_channels" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_members_channel_user_uq" ON "chat_members" USING btree ("channel_id","user_id");--> statement-breakpoint
CREATE INDEX "chat_members_channel_id_idx" ON "chat_members" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "chat_members_user_id_idx" ON "chat_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_channel_seq_uq" ON "chat_messages" USING btree ("channel_id","seq");--> statement-breakpoint
CREATE INDEX "chat_messages_parent_id_idx" ON "chat_messages" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reactions_message_user_emoji_uq" ON "chat_reactions" USING btree ("message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "chat_reactions_message_id_idx" ON "chat_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reads_user_channel_uq" ON "chat_reads" USING btree ("user_id","channel_id");--> statement-breakpoint
CREATE INDEX "chat_reads_channel_id_idx" ON "chat_reads" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "docs_pages_space_id_idx" ON "docs_pages" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "docs_pages_parent_id_idx" ON "docs_pages" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "docs_task_links_page_task_uq" ON "docs_task_links" USING btree ("page_id","task_id");--> statement-breakpoint
CREATE INDEX "docs_task_links_space_id_idx" ON "docs_task_links" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "docs_task_links_page_id_idx" ON "docs_task_links" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "docs_task_links_task_id_idx" ON "docs_task_links" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('assigned', 'mentioned', 'commented', 'status_changed', 'chat_mention', 'chat_dm', 'chat_reply'));