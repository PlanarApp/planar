ALTER TABLE "ai_runs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
UPDATE "ai_runs" SET "finished_at" = "updated_at" WHERE "state" IN ('done', 'failed', 'cancelled');--> statement-breakpoint
CREATE FUNCTION "ai_runs_set_finished_at"() RETURNS trigger AS $$
BEGIN
  IF NEW.state NOT IN ('done', 'failed', 'cancelled') THEN
    NEW.finished_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.finished_at := coalesce(NEW.finished_at, now());
  ELSIF OLD.state NOT IN ('done', 'failed', 'cancelled') THEN
    NEW.finished_at := now();
  ELSE
    NEW.finished_at := OLD.finished_at;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "ai_runs_finished_at" BEFORE INSERT OR UPDATE OF "state" ON "ai_runs" FOR EACH ROW EXECUTE FUNCTION "ai_runs_set_finished_at"();
