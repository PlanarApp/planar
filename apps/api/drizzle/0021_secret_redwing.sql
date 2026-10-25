CREATE TABLE "email_config" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"secure" boolean DEFAULT false NOT NULL,
	"username" text,
	"password_enc" text,
	"from_address" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_digests" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_digests_user_id_date_pk" PRIMARY KEY("user_id","date"),
	CONSTRAINT "email_digests_status_check" CHECK (status in ('sending','sent','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"notification_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_outbox_status_check" CHECK (status in ('sending','sent','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "email_prefs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"notify" boolean NOT NULL,
	"digest" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_digests" ADD CONSTRAINT "email_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;