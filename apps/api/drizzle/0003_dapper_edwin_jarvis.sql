CREATE TABLE "hello_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hello_notes_space_id_idx" ON "hello_notes" USING btree ("space_id");