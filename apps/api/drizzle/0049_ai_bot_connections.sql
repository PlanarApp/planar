CREATE TABLE "ai_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"base_url" text,
	"key_enc" text NOT NULL,
	"model" text NOT NULL,
	"price_in" double precision,
	"price_out" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_connections_scope_uq" ON "ai_connections" USING btree ("scope","scope_id");