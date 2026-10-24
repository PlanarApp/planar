CREATE TABLE "ydocs" (
	"doc_id" text PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
