CREATE TABLE "ai_harness_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"entity_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_harness_packs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"pack_key" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"root_page_id" uuid,
	"hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_harness_keys_project_kind_key_uq" ON "ai_harness_keys" USING btree ("project_id","kind","key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_harness_packs_project_pack_uq" ON "ai_harness_packs" USING btree ("project_id","pack_key");