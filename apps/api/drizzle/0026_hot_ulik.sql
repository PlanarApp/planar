ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('assigned', 'mentioned', 'commented', 'status_changed', 'chat_mention', 'chat_dm', 'chat_reply', 'comment_assigned'));