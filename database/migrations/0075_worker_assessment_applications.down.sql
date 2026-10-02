DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM worker_assessment_application_events LIMIT 1)
     OR EXISTS (SELECT 1 FROM worker_assessment_applications LIMIT 1) THEN
    RAISE EXCEPTION 'Cannot remove Worker assessment application history after records exist.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS worker_assessment_application_events_append_only
  ON worker_assessment_application_events;
DROP FUNCTION IF EXISTS hse_worker_assessment_application_events_append_only();
DROP TABLE IF EXISTS worker_assessment_application_events;
DROP TABLE IF EXISTS worker_assessment_applications;
