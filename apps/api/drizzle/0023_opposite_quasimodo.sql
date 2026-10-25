CREATE TABLE "plugins_plugins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"origin" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"points" jsonb NOT NULL,
	"enabled" boolean NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
