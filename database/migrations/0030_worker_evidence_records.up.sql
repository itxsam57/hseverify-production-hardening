-- M1.11 Worker evidence records.
--
-- Compliance history in this brick is monotonic. Hard foreign keys are used only
-- between tables owned by M1.11. Worker-account and secure-file identifiers are
-- retained as opaque cross-brick references and are revalidated by authenticated
-- services before mutation, so retained M1.11 history can never block rollback of
-- authentication, Worker identity or secure-file bricks.

CREATE TABLE IF NOT EXISTS worker_evidence_records (
  record_id TEXT PRIMARY KEY,
  worker_account_id TEXT NOT NULL,
  record_kind TEXT NOT NULL
    CHECK (record_kind IN ('qualification', 'experience', 'employment', 'skill')),
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'ended', 'inactive')),
  current_version_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_evidence_versions (
  version_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL
    REFERENCES worker_evidence_records(record_id),
  version_number INTEGER NOT NULL
    CHECK (version_number > 0),
  revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision > 0),
  version_status TEXT NOT NULL
    CHECK (version_status IN ('draft', 'submitted', 'superseded')),
  supersedes_version_id TEXT NULL
    REFERENCES worker_evidence_versions(version_id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NULL,
  UNIQUE (record_id, version_number),
  CHECK (
    (version_status = 'draft' AND submitted_at IS NULL)
    OR (version_status IN ('submitted', 'superseded') AND submitted_at IS NOT NULL)
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'worker_evidence_records_current_version_fkey'
       AND conrelid = 'worker_evidence_records'::regclass
  ) THEN
    ALTER TABLE worker_evidence_records
      ADD CONSTRAINT worker_evidence_records_current_version_fkey
      FOREIGN KEY (current_version_id)
      REFERENCES worker_evidence_versions(version_id);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS worker_qualification_versions (
  version_id TEXT PRIMARY KEY
    REFERENCES worker_evidence_versions(version_id),
  qualification_title TEXT NULL,
  category TEXT NULL,
  issuing_organization TEXT NULL,
  learning_provider TEXT NULL,
  certificate_number TEXT NULL,
  issue_date DATE NULL,
  expiry_date DATE NULL,
  qualification_level TEXT NULL,
  country TEXT NULL,
  verification_url TEXT NULL,
  declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date)
);

CREATE TABLE IF NOT EXISTS worker_experience_versions (
  version_id TEXT PRIMARY KEY
    REFERENCES worker_evidence_versions(version_id),
  company_name TEXT NULL,
  role_title TEXT NULL,
  duties TEXT NULL,
  country TEXT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  experience_status TEXT NOT NULL DEFAULT 'current'
    CHECK (experience_status IN ('current', 'ended')),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (
    (experience_status = 'current' AND end_date IS NULL)
    OR (experience_status = 'ended' AND end_date IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS worker_employment_versions (
  version_id TEXT PRIMARY KEY
    REFERENCES worker_evidence_versions(version_id),
  company_name TEXT NULL,
  role_title TEXT NULL,
  duties TEXT NULL,
  country TEXT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  employment_status TEXT NOT NULL DEFAULT 'current'
    CHECK (employment_status IN ('current', 'ended')),
  end_reason TEXT NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (
    (employment_status = 'current' AND end_date IS NULL)
    OR (employment_status = 'ended' AND end_date IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS worker_skill_versions (
  version_id TEXT PRIMARY KEY
    REFERENCES worker_evidence_versions(version_id),
  skill_name TEXT NULL,
  category TEXT NULL,
  proficiency_claim TEXT NULL,
  experience_months INTEGER NULL
    CHECK (experience_months IS NULL OR experience_months >= 0),
  related_trade TEXT NULL,
  skill_assurance_status TEXT NOT NULL DEFAULT 'self_declared'
    CHECK (
      skill_assurance_status IN (
        'self_declared',
        'evidence_verified',
        'competency_assessed'
      )
    )
);

CREATE TABLE IF NOT EXISTS worker_evidence_attachments (
  attachment_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL
    REFERENCES worker_evidence_records(record_id),
  version_id TEXT NOT NULL
    REFERENCES worker_evidence_versions(version_id),
  attachment_kind TEXT NOT NULL
    CHECK (
      attachment_kind IN (
        'primary_certificate',
        'supporting_evidence',
        'experience_evidence',
        'employment_evidence',
        'skill_evidence'
      )
    ),
  secure_file_id TEXT NOT NULL,
  display_filename TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  superseded_at TIMESTAMPTZ NULL,
  UNIQUE (version_id, attachment_kind, secure_file_id)
);

CREATE TABLE IF NOT EXISTS worker_evidence_file_candidates (
  candidate_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL
    REFERENCES worker_evidence_records(record_id),
  version_id TEXT NOT NULL
    REFERENCES worker_evidence_versions(version_id),
  binding_kind TEXT NOT NULL
    CHECK (
      binding_kind IN (
        'primary_certificate',
        'supporting_evidence',
        'experience_evidence',
        'employment_evidence',
        'skill_evidence',
        'leaving_letter'
      )
    ),
  secure_file_id TEXT NOT NULL UNIQUE,
  reservation_key TEXT NOT NULL
    CHECK (reservation_key ~ '^[0-9a-f]{64}$'),
  display_filename TEXT NOT NULL
    CHECK (char_length(display_filename) BETWEEN 1 AND 240),
  expected_active_binding_id TEXT NULL,
  candidate_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (candidate_status IN ('pending', 'finalized')),
  created_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ NULL,
  CHECK (
    (candidate_status = 'pending' AND finalized_at IS NULL)
    OR (candidate_status = 'finalized' AND finalized_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS worker_employment_leaving_letters (
  leaving_letter_id TEXT PRIMARY KEY,
  employment_record_id TEXT NOT NULL
    REFERENCES worker_evidence_records(record_id),
  employment_version_id TEXT NOT NULL
    REFERENCES worker_evidence_versions(version_id),
  secure_file_id TEXT NOT NULL,
  display_filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded')),
  supersedes_leaving_letter_id TEXT NULL
    REFERENCES worker_employment_leaving_letters(leaving_letter_id),
  created_at TIMESTAMPTZ NOT NULL,
  superseded_at TIMESTAMPTZ NULL,
  CHECK (
    (status = 'active' AND superseded_at IS NULL)
    OR (status = 'superseded' AND superseded_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS worker_evidence_records_worker_kind_status_idx
  ON worker_evidence_records (worker_account_id, record_kind, lifecycle_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS worker_evidence_versions_record_status_idx
  ON worker_evidence_versions (record_id, version_status, version_number DESC);

CREATE UNIQUE INDEX IF NOT EXISTS worker_evidence_versions_one_draft_idx
  ON worker_evidence_versions (record_id)
  WHERE version_status = 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS worker_evidence_attachments_active_primary_idx
  ON worker_evidence_attachments (version_id)
  WHERE attachment_kind = 'primary_certificate' AND superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS worker_evidence_attachments_record_version_idx
  ON worker_evidence_attachments (record_id, version_id, attachment_kind, created_at);

CREATE INDEX IF NOT EXISTS worker_evidence_file_candidates_record_status_idx
  ON worker_evidence_file_candidates (
    record_id, version_id, candidate_status, created_at
  );

CREATE UNIQUE INDEX IF NOT EXISTS worker_employment_leaving_letters_active_idx
  ON worker_employment_leaving_letters (employment_record_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS worker_employment_leaving_letters_history_idx
  ON worker_employment_leaving_letters (employment_record_id, created_at DESC);

CREATE OR REPLACE FUNCTION hse_validate_worker_evidence_current_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM worker_evidence_versions AS versions
     WHERE versions.version_id = NEW.current_version_id
       AND versions.record_id = NEW.record_id
  ) THEN
    RAISE EXCEPTION 'Current evidence version must belong to the same record.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.lifecycle_status = 'ended' AND NEW.record_kind NOT IN ('experience', 'employment') THEN
    RAISE EXCEPTION 'Only experience or employment evidence can be ended.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.lifecycle_status = 'inactive' AND NEW.record_kind <> 'skill' THEN
    RAISE EXCEPTION 'Only skill evidence can be inactive.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_evidence_current_version_guard
  ON worker_evidence_records;
CREATE TRIGGER worker_evidence_current_version_guard
BEFORE INSERT OR UPDATE OF current_version_id, lifecycle_status, record_kind
ON worker_evidence_records
FOR EACH ROW EXECUTE FUNCTION hse_validate_worker_evidence_current_version();

CREATE OR REPLACE FUNCTION hse_validate_worker_evidence_version_lineage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  superseded_record_id TEXT;
  superseded_version_number INTEGER;
BEGIN
  IF NEW.supersedes_version_id IS NULL THEN
    IF NEW.version_number <> 1 THEN
      RAISE EXCEPTION 'First evidence version must use version number 1.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT record_id, version_number
    INTO superseded_record_id, superseded_version_number
    FROM worker_evidence_versions
   WHERE version_id = NEW.supersedes_version_id;

  IF superseded_record_id IS NULL
     OR superseded_record_id <> NEW.record_id
     OR NEW.version_number <> superseded_version_number + 1 THEN
    RAISE EXCEPTION 'Evidence version lineage must stay on the same record and advance by one.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_evidence_version_lineage_guard
  ON worker_evidence_versions;
CREATE TRIGGER worker_evidence_version_lineage_guard
BEFORE INSERT OR UPDATE OF record_id, version_number, supersedes_version_id
ON worker_evidence_versions
FOR EACH ROW EXECUTE FUNCTION hse_validate_worker_evidence_version_lineage();

CREATE OR REPLACE FUNCTION hse_validate_worker_qualification_detail_kind()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM worker_evidence_versions AS versions
      JOIN worker_evidence_records AS records
        ON records.record_id = versions.record_id
     WHERE versions.version_id = NEW.version_id
       AND records.record_kind = 'qualification'
  ) THEN
    RAISE EXCEPTION 'Qualification detail requires a qualification record.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_qualification_detail_kind_guard
  ON worker_qualification_versions;
CREATE TRIGGER worker_qualification_detail_kind_guard
BEFORE INSERT OR UPDATE OF version_id
ON worker_qualification_versions
FOR EACH ROW EXECUTE FUNCTION hse_validate_worker_qualification_detail_kind();

CREATE OR REPLACE FUNCTION hse_validate_worker_experience_detail_kind()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM worker_evidence_versions AS versions
      JOIN worker_evidence_records AS records
        ON records.record_id = versions.record_id
     WHERE versions.version_id = NEW.version_id
       AND records.record_kind = 'experience'
  ) THEN
    RAISE EXCEPTION 'Experience detail requires an experience record.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_experience_detail_kind_guard
  ON worker_experience_versions;
CREATE TRIGGER worker_experience_detail_kind_guard
BEFORE INSERT OR UPDATE OF version_id
ON worker_experience_versions
FOR EACH ROW EXECUTE FUNCTION hse_validate_worker_experience_detail_kind();

CREATE OR REPLACE FUNCTION hse_validate_worker_employment_detail_kind()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM worker_evidence_versions AS versions
      JOIN worker_evidence_records AS records
        ON records.record_id = versions.record_id
     WHERE versions.version_id = NEW.version_id
       AND records.record_kind = 'employment'
  ) THEN
    RAISE EXCEPTION 'Employment detail requires an employment record.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_employment_detail_kind_guard
  ON worker_employment_versions;
CREATE TRIGGER worker_employment_detail_kind_guard
BEFORE INSERT OR UPDATE OF version_id
ON worker_employment_versions
FOR EACH ROW EXECUTE FUNCTION hse_validate_worker_employment_detail_kind();

CREATE OR REPLACE FUNCTION hse_validate_worker_skill_detail_kind()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM worker_evidence_versions AS versions
      JOIN worker_evidence_records AS records
        ON records.record_id = versions.record_id
     WHERE versions.version_id = NEW.version_id
       AND records.record_kind = 'skill'
  ) THEN
    RAISE EXCEPTION 'Skill detail requires a skill record.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_skill_detail_kind_guard
  ON worker_skill_versions;
CREATE TRIGGER worker_skill_detail_kind_guard
BEFORE INSERT OR UPDATE OF version_id
ON worker_skill_versions
FOR EACH ROW EXECUTE FUNCTION hse_validate_worker_skill_detail_kind();

CREATE OR REPLACE FUNCTION hse_validate_worker_evidence_attachment_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  version_record_id TEXT;
  record_kind_value TEXT;
BEGIN
  SELECT versions.record_id, records.record_kind
    INTO version_record_id, record_kind_value
    FROM worker_evidence_versions AS versions
    JOIN worker_evidence_records AS records
      ON records.record_id = versions.record_id
   WHERE versions.version_id = NEW.version_id;

  IF version_record_id IS NULL OR version_record_id <> NEW.record_id THEN
    RAISE EXCEPTION 'Evidence attachment record and version must match.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.attachment_kind IN ('primary_certificate', 'supporting_evidence')
     AND record_kind_value <> 'qualification' THEN
    RAISE EXCEPTION 'Qualification attachment requires a qualification record.'
      USING ERRCODE = '23514';
  ELSIF NEW.attachment_kind = 'experience_evidence'
     AND record_kind_value <> 'experience' THEN
    RAISE EXCEPTION 'Experience attachment requires an experience record.'
      USING ERRCODE = '23514';
  ELSIF NEW.attachment_kind = 'employment_evidence'
     AND record_kind_value <> 'employment' THEN
    RAISE EXCEPTION 'Employment attachment requires an employment record.'
      USING ERRCODE = '23514';
  ELSIF NEW.attachment_kind = 'skill_evidence'
     AND record_kind_value <> 'skill' THEN
    RAISE EXCEPTION 'Skill attachment requires a skill record.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_evidence_attachment_scope_guard
  ON worker_evidence_attachments;
CREATE TRIGGER worker_evidence_attachment_scope_guard
BEFORE INSERT OR UPDATE OF record_id, version_id, attachment_kind
ON worker_evidence_attachments
FOR EACH ROW EXECUTE FUNCTION hse_validate_worker_evidence_attachment_scope();

CREATE OR REPLACE FUNCTION hse_validate_worker_evidence_file_candidate_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  version_record_id TEXT;
  record_kind_value TEXT;
BEGIN
  SELECT versions.record_id, records.record_kind
    INTO version_record_id, record_kind_value
    FROM worker_evidence_versions AS versions
    JOIN worker_evidence_records AS records
      ON records.record_id = versions.record_id
   WHERE versions.version_id = NEW.version_id;

  IF version_record_id IS NULL OR version_record_id <> NEW.record_id THEN
    RAISE EXCEPTION 'Candidate record and version must match.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.binding_kind IN ('primary_certificate', 'supporting_evidence')
     AND record_kind_value <> 'qualification' THEN
    RAISE EXCEPTION 'Candidate file type does not belong to this record.'
      USING ERRCODE = '23514';
  ELSIF NEW.binding_kind = 'experience_evidence'
     AND record_kind_value <> 'experience' THEN
    RAISE EXCEPTION 'Candidate file type does not belong to this record.'
      USING ERRCODE = '23514';
  ELSIF NEW.binding_kind IN ('employment_evidence', 'leaving_letter')
     AND record_kind_value <> 'employment' THEN
    RAISE EXCEPTION 'Candidate file type does not belong to this record.'
      USING ERRCODE = '23514';
  ELSIF NEW.binding_kind = 'skill_evidence'
     AND record_kind_value <> 'skill' THEN
    RAISE EXCEPTION 'Candidate file type does not belong to this record.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_evidence_file_candidate_scope_guard
  ON worker_evidence_file_candidates;
CREATE TRIGGER worker_evidence_file_candidate_scope_guard
BEFORE INSERT OR UPDATE OF record_id, version_id, binding_kind
ON worker_evidence_file_candidates
FOR EACH ROW EXECUTE FUNCTION hse_validate_worker_evidence_file_candidate_scope();

CREATE OR REPLACE FUNCTION hse_guard_worker_evidence_file_candidate_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'File candidate history is immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.candidate_status = 'finalized' THEN
    RAISE EXCEPTION 'Finalized file candidate is immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.record_id IS DISTINCT FROM OLD.record_id
     OR NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.binding_kind IS DISTINCT FROM OLD.binding_kind
     OR NEW.secure_file_id IS DISTINCT FROM OLD.secure_file_id
     OR NEW.reservation_key IS DISTINCT FROM OLD.reservation_key
     OR NEW.display_filename IS DISTINCT FROM OLD.display_filename
     OR NEW.expected_active_binding_id IS DISTINCT FROM OLD.expected_active_binding_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Candidate identity is immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.candidate_status <> 'finalized' OR NEW.finalized_at IS NULL THEN
    RAISE EXCEPTION 'Pending file candidate may only transition to finalized.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_evidence_file_candidate_history_guard
  ON worker_evidence_file_candidates;
CREATE TRIGGER worker_evidence_file_candidate_history_guard
BEFORE UPDATE OR DELETE ON worker_evidence_file_candidates
FOR EACH ROW EXECUTE FUNCTION hse_guard_worker_evidence_file_candidate_history();

CREATE OR REPLACE FUNCTION hse_validate_worker_employment_leaving_letter_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  version_record_id TEXT;
  record_kind_value TEXT;
BEGIN
  SELECT versions.record_id, records.record_kind
    INTO version_record_id, record_kind_value
    FROM worker_evidence_versions AS versions
    JOIN worker_evidence_records AS records
      ON records.record_id = versions.record_id
   WHERE versions.version_id = NEW.employment_version_id;

  IF record_kind_value IS DISTINCT FROM 'employment' THEN
    RAISE EXCEPTION 'Leaving letter requires an employment record.'
      USING ERRCODE = '23514';
  END IF;

  IF version_record_id IS NULL OR version_record_id <> NEW.employment_record_id THEN
    RAISE EXCEPTION 'Leaving letter record and version must match the same employment.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_employment_leaving_letter_scope_guard
  ON worker_employment_leaving_letters;
CREATE TRIGGER worker_employment_leaving_letter_scope_guard
BEFORE INSERT OR UPDATE OF employment_record_id, employment_version_id
ON worker_employment_leaving_letters
FOR EACH ROW EXECUTE FUNCTION hse_validate_worker_employment_leaving_letter_scope();

-- M1.11 extends the accepted immutable audit vocabulary without weakening prior actions.
ALTER TABLE platform_audit_events
  DROP CONSTRAINT IF EXISTS platform_audit_events_action_key_check;
ALTER TABLE platform_audit_events
  ADD CONSTRAINT platform_audit_events_action_key_check CHECK (
    action_key IN (
      'authentication.registration.started',
      'authentication.otp.issued',
      'authentication.otp.failed',
      'authentication.otp.verified',
      'authentication.password.created',
      'authentication.password_reset.requested',
      'authentication.password_reset.completed',
      'authentication.login.failed',
      'authentication.login.succeeded',
      'authentication.logout',
      'authentication.session.revoked',
      'authentication.account.locked',
      'authentication.account.unlocked',
      'authentication.invitation.created',
      'authentication.invitation.accepted',
      'authentication.mfa.enrolled',
      'authentication.mfa.failed',
      'authentication.mfa.succeeded',
      'authorization.access.denied',
      'outbox.job.enqueued',
      'outbox.job.claimed',
      'outbox.job.lease_reclaimed',
      'outbox.job.succeeded',
      'outbox.job.retry_scheduled',
      'outbox.job.terminal_failed',
      'notification.projected',
      'notification.read',
      'notification.deep_link.denied',
      'email.delivery.queued',
      'email.delivery.attempt.started',
      'email.delivery.delivered',
      'email.delivery.retry_scheduled',
      'email.delivery.terminal_failed',
      'secure_file.quarantined',
      'secure_file.scan.queued',
      'secure_file.scan.available',
      'secure_file.scan.unsafe',
      'secure_file.scan.failed',
      'secure_file.access.authorized',
      'secure_file.access.served',
      'worker_identity.created',
      'worker_identity.status.changed',
      'worker_identity.duplicate.evaluated',
      'worker_identity.duplicate.disposition.recorded',
      'worker_identity.worker_id.issued',
      'company_verification.updated',
      'company_verification.evidence.bound',
      'company_verification.submitted',
      'company_verification.withdrawn',
      'company_verification.status.changed',
      'company_organization.created',
      'company_organization.updated',
      'company_organization.archived',
      'company_organization.restored',
      'company_team.invitation.created',
      'company_team.invitation.revoked',
      'company_team.membership.updated',
      'company_team.membership.suspended',
      'company_team.membership.reactivated',
      'company_team.membership.revoked',
      'company_workforce.invitation.created',
      'company_workforce.invitation.resent',
      'company_workforce.invitation.revoked',
      'company_workforce.invitation.accepted',
      'company_workforce.code.created',
      'company_workforce.code.revoked',
      'company_workforce.code.redeemed',
      'company_workforce.link.requested',
      'company_workforce.link.accepted',
      'company_workforce.link.revoked',
      'worker_evidence.record.created',
      'worker_evidence.draft.saved',
      'worker_evidence.file.attached',
      'worker_evidence.file.replaced',
      'worker_evidence.version.submitted',
      'worker_evidence.revision.started',
      'worker_evidence.employment.ended',
      'worker_evidence.skill.inactivated',
      'worker_evidence.leaving_letter.attached',
      'worker_evidence.leaving_letter.replaced'
    )
  );
