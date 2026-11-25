CREATE TABLE "ai_connection_choices" (
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL
);
--> statement-breakpoint
DROP INDEX "ai_connections_scope_uq";--> statement-breakpoint
ALTER TABLE "ai_harness_keys" ADD COLUMN "models" jsonb;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "ai_connection_choices" ADD CONSTRAINT "ai_connection_choices_connection_id_ai_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_connection_choices_scope_uq" ON "ai_connection_choices" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_connections_scope_uq" ON "ai_connections" USING btree ("scope","scope_id") WHERE "ai_connections"."scope" <> 'workspace';