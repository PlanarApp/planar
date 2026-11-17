ALTER TABLE "ai_actions" ADD COLUMN "review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "ai_runs_set_finished_at"() RETURNS trigger AS $$
BEGIN
  -- PLNRAPP-405: waiting_subtasks ends the run's own work: its time does not grow while the subtasks run
  IF NEW.state NOT IN ('done', 'failed', 'cancelled', 'waiting_subtasks') THEN
    NEW.finished_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.finished_at := coalesce(NEW.finished_at, now());
  ELSIF OLD.state NOT IN ('done', 'failed', 'cancelled', 'waiting_subtasks') THEN
    NEW.finished_at := now();
  ELSE
    NEW.finished_at := OLD.finished_at;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
