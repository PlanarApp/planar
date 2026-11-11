CREATE TABLE "docs_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"source" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "docs_versions_page_id_idx" ON "docs_versions" USING btree ("page_id","created_at");