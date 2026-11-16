ALTER TABLE "import_jobs" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "space_id" uuid;