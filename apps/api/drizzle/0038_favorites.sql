CREATE TABLE "favorites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"rank" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_kind_check" CHECK ("favorites"."kind" in ('workspace', 'space', 'project', 'doc', 'chat', 'task'))
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_ref_id_user_id_kind_index" ON "favorites" USING btree ("ref_id","user_id","kind");