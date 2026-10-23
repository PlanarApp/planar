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
CREATE INDEX "docs_pages_space_id_idx" ON "docs_pages" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "docs_pages_parent_id_idx" ON "docs_pages" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "docs_task_links_page_task_uq" ON "docs_task_links" USING btree ("page_id","task_id");--> statement-breakpoint
CREATE INDEX "docs_task_links_space_id_idx" ON "docs_task_links" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "docs_task_links_page_id_idx" ON "docs_task_links" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "docs_task_links_task_id_idx" ON "docs_task_links" USING btree ("task_id");