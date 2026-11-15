CREATE TABLE "docs_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" jsonb NOT NULL,
	"mentions" jsonb NOT NULL,
	"assignee_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "docs_comments_space_id_idx" ON "docs_comments" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "docs_comments_page_id_idx" ON "docs_comments" USING btree ("page_id");--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('assigned', 'mentioned', 'commented', 'status_changed', 'chat_mention', 'chat_dm', 'chat_reply', 'comment_assigned', 'doc_mention', 'trial_ending', 'checklist_assigned', 'due_today', 'start_today', 'doc_comment_assigned'));