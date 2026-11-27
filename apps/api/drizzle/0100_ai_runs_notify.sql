-- PLNRAPP-884: a run of a task changed its state — a signal to the clients (the AI tab's count, the indicator),
-- without polling. pg_notify goes out on commit; equal payloads of one transaction are merged by Postgres.
CREATE FUNCTION "ai_runs_notify"() RETURNS trigger AS $$
DECLARE
  r ai_runs;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF r.task_id IS NOT NULL THEN
    PERFORM pg_notify('planar_work', json_build_object(
      'entity', 'tasks',
      'id', r.task_id,
      'projectId', coalesce(r.project_id, (SELECT t.project_id FROM tasks t WHERE t.id = r.task_id))
    )::text);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "ai_runs_notify_ins_del" AFTER INSERT OR DELETE ON "ai_runs" FOR EACH ROW EXECUTE FUNCTION "ai_runs_notify"();--> statement-breakpoint
CREATE TRIGGER "ai_runs_notify_upd" AFTER UPDATE OF "state" ON "ai_runs" FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION "ai_runs_notify"();
