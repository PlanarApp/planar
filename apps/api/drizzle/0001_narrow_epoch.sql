CREATE TABLE "file_uploads" (
	"sha256" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_uploads_sha256_user_id_pk" PRIMARY KEY("sha256","user_id")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_sha256_files_sha256_fk" FOREIGN KEY ("sha256") REFERENCES "public"."files"("sha256") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;