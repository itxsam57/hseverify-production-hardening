-- M1.07 Subunit 4: Automated Identity Checks and Provider Adapter Boundary.
-- Durable work reuses the accepted M1.05 outbox. Provider/check summaries are
-- bounded codes only; raw identity evidence and sensitive identity facts are not
-- persisted in this domain.

ALTER TABLE platform_outbox_jobs
  DROP CONSTRAINT IF EXISTS platform_outbox_jobs_job_type_check;
ALTER TABLE platform_outbox_jobs
  ADD CONSTRAINT platform_outbox_jobs_job_type_check CHECK (
    job_type IN (
      'platform.foundation.noop',
      'notification.portal.foundation',
      'email.delivery.foundation',
      'secure_file.scan',
      'worker_identity.automated_checks'
    )
  );

CREATE TABLE IF NOT EXISTS worker_identity_check_runs (
  run_id TEXT PRIMARY KEY CHECK (
    run_id ~ '^identity_check_run_[A-Za-z0-9_-]{24}$'
  ),
  identity_id TEXT NOT NULL
    REFERENCES worker_identities(identity_id) ON DELETE RESTRICT,
  identity_version_id TEXT NOT NULL
    REFERENCES worker_identity_versions(identity_version_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL CHECK (
    char_length(worker_account_id) BETWEEN 8 AND 160
  ),
  job_id TEXT NOT NULL UNIQUE CHECK (
    job_id ~ '^job_[A-Za-z0-9_-]{24}$'
  ),
  run_status TEXT NOT NULL CHECK (
    run_status IN ('processing', 'completed', 'provider_unavailable', 'failed', 'stale')
  ),
  adapter_key TEXT NULL CHECK (
    adapter_key IS NULL OR adapter_key IN ('deterministic_local_test', 'unconfigured')
  ),
  failure_code TEXT NULL CHECK (
    failure_code IS NULL OR (
      char_length(failure_code) BETWEEN 2 AND 120 AND
      failure_code ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT worker_identity_check_run_terminal_shape CHECK (
    (run_status = 'processing' AND completed_at IS NULL AND failure_code IS NULL) OR
    (run_status = 'completed' AND completed_at IS NOT NULL AND failure_code IS NULL AND adapter_key IS NOT NULL) OR
    (run_status IN ('provider_unavailable', 'failed', 'stale') AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
  ),
  CONSTRAINT worker_identity_check_run_identity_version_unique
    UNIQUE (identity_version_id)
);

CREATE INDEX IF NOT EXISTS worker_identity_check_runs_identity_idx
  ON worker_identity_check_runs (identity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS worker_identity_check_results (
  run_id TEXT NOT NULL
    REFERENCES worker_identity_check_runs(run_id) ON DELETE RESTRICT,
  check_type TEXT NOT NULL CHECK (
    check_type IN ('document_consistency', 'face_comparison', 'liveness')
  ),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('passed', 'needs_review')
  ),
  result_code TEXT NOT NULL CHECK (
    char_length(result_code) BETWEEN 2 AND 120 AND
    result_code ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, check_type)
);

CREATE OR REPLACE FUNCTION worker_identity_check_run_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_identity_version TEXT;
  current_status TEXT;
  version_status_value TEXT;
BEGIN
  SELECT
    versions.identity_version_id,
    identities.lifecycle_status,
    versions.version_status
  INTO
    current_identity_version,
    current_status,
    version_status_value
  FROM worker_identities AS identities
  JOIN worker_identity_versions AS versions
    ON versions.identity_id = identities.identity_id
   AND versions.version_number = identities.current_version_number
  WHERE identities.identity_id = NEW.identity_id
    AND identities.worker_account_id = NEW.worker_account_id;

  IF current_identity_version IS NULL OR
     current_identity_version <> NEW.identity_version_id OR
     version_status_value <> 'submitted' OR
     current_status NOT IN ('submitted', 'automated_checks') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Automated checks must target the exact current submitted Worker identity version.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform_outbox_jobs AS jobs
    WHERE jobs.job_id = NEW.job_id
      AND jobs.job_type = 'worker_identity.automated_checks'
      AND jobs.schema_version = 1
      AND jobs.status = 'leased'
      AND jobs.enqueued_by_account_id = NEW.worker_account_id
      AND jobs.enqueued_by_role = 'worker'
      AND jobs.tenant_id IS NULL
      AND jobs.membership_id IS NULL
      AND jobs.payload ->> 'identityRef' = NEW.identity_id
      AND jobs.payload ->> 'versionRef' = NEW.identity_version_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Automated-check run requires the exact leased outbox job binding.';
  END IF;

  IF NEW.run_status <> 'processing' OR
     NEW.adapter_key IS NOT NULL OR
     NEW.failure_code IS NOT NULL OR
     NEW.completed_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Automated-check runs must begin in processing state.';
  END IF;

  NEW.created_at := CURRENT_TIMESTAMP;
  NEW.started_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_check_run_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.run_id IS DISTINCT FROM OLD.run_id OR
     NEW.identity_id IS DISTINCT FROM OLD.identity_id OR
     NEW.identity_version_id IS DISTINCT FROM OLD.identity_version_id OR
     NEW.worker_account_id IS DISTINCT FROM OLD.worker_account_id OR
     NEW.job_id IS DISTINCT FROM OLD.job_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Automated-check run identity and provenance are immutable.';
  END IF;

  IF OLD.run_status <> 'processing' OR
     NEW.run_status NOT IN ('completed', 'provider_unavailable', 'failed', 'stale') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Automated-check run transition is invalid.';
  END IF;

  NEW.completed_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_check_result_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM worker_identity_check_runs AS runs
    WHERE runs.run_id = NEW.run_id
      AND runs.run_status = 'processing'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Automated-check results may be written only while the exact run is processing.';
  END IF;
  NEW.created_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_identity_check_runs_validate_insert
  ON worker_identity_check_runs;
CREATE TRIGGER worker_identity_check_runs_validate_insert
BEFORE INSERT ON worker_identity_check_runs
FOR EACH ROW
EXECUTE FUNCTION worker_identity_check_run_validate_insert();

DROP TRIGGER IF EXISTS worker_identity_check_runs_guard_update
  ON worker_identity_check_runs;
CREATE TRIGGER worker_identity_check_runs_guard_update
BEFORE UPDATE ON worker_identity_check_runs
FOR EACH ROW
EXECUTE FUNCTION worker_identity_check_run_guard_update();

DROP TRIGGER IF EXISTS worker_identity_check_runs_no_delete
  ON worker_identity_check_runs;
CREATE TRIGGER worker_identity_check_runs_no_delete
BEFORE DELETE ON worker_identity_check_runs
FOR EACH ROW
EXECUTE FUNCTION worker_identity_reject_delete();

DROP TRIGGER IF EXISTS worker_identity_check_results_validate_insert
  ON worker_identity_check_results;
CREATE TRIGGER worker_identity_check_results_validate_insert
BEFORE INSERT ON worker_identity_check_results
FOR EACH ROW
EXECUTE FUNCTION worker_identity_check_result_validate_insert();

DROP TRIGGER IF EXISTS worker_identity_check_results_no_update
  ON worker_identity_check_results;
CREATE TRIGGER worker_identity_check_results_no_update
BEFORE UPDATE ON worker_identity_check_results
FOR EACH ROW
EXECUTE FUNCTION worker_identity_reject_delete();

DROP TRIGGER IF EXISTS worker_identity_check_results_no_delete
  ON worker_identity_check_results;
CREATE TRIGGER worker_identity_check_results_no_delete
BEFORE DELETE ON worker_identity_check_results
FOR EACH ROW
EXECUTE FUNCTION worker_identity_reject_delete();

-- If the shared outbox exhausts retries for an identity-check job without the
-- handler completing the run, close the durable run as failed but do not advance
-- the Worker identity. This is fail-closed and preserves a recoverable diagnosis.
CREATE OR REPLACE FUNCTION worker_identity_sync_terminal_check_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.job_type <> 'worker_identity.automated_checks' OR
     NEW.status <> 'terminal_failed' OR
     OLD.status = 'terminal_failed' THEN
    RETURN NEW;
  END IF;

  UPDATE worker_identity_check_runs
  SET run_status = 'failed',
      adapter_key = COALESCE(adapter_key, 'unconfigured'),
      failure_code = COALESCE(NEW.last_error_code, 'outbox_terminal_failed')
  WHERE job_id = NEW.job_id
    AND run_status = 'processing';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_outbox_sync_terminal_identity_checks
  ON platform_outbox_jobs;
CREATE TRIGGER platform_outbox_sync_terminal_identity_checks
AFTER UPDATE OF status ON platform_outbox_jobs
FOR EACH ROW
EXECUTE FUNCTION worker_identity_sync_terminal_check_job();
