CREATE TABLE "forms_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"form_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"single_use" boolean NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "forms_links_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "forms_links_form_id_idx" ON "forms_links" USING btree ("form_id");