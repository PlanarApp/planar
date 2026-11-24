CREATE TABLE "files_deleted" (
	"sha256" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION "attachments_files_deleted"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "files_deleted" ("sha256", "deleted_at") VALUES (OLD.file_sha256, now())
    ON CONFLICT ("sha256") DO UPDATE SET "deleted_at" = now();
  RETURN OLD;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "attachments_files_deleted" AFTER DELETE ON "attachments" FOR EACH ROW EXECUTE FUNCTION "attachments_files_deleted"();
