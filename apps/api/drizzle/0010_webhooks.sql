CREATE TABLE "webhooks_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhooks_deliveries_status_chk" CHECK ("webhooks_deliveries"."status" in ('pending', 'ok', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "webhooks_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret" text NOT NULL,
	"active" boolean NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhooks_deliveries" ADD CONSTRAINT "webhooks_deliveries_subscription_id_webhooks_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhooks_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhooks_deliveries_sub_created_idx" ON "webhooks_deliveries" USING btree ("subscription_id","created_at" DESC NULLS LAST);