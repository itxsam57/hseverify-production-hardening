-- M2.05 Randomized Assessment Form Generation.
-- Stable blueprints point to immutable versions. Generated forms and items are immutable history.

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
      'worker_evidence.leaving_letter.replaced',
      'public_verification.concern.received',
      'assurance_order.created',
      'assurance_order.updated',
      'assurance_order.validated',
      'assurance_order.submitted',
      'assurance_order.cancelled',
      'assurance_case.created',
      'assurance_case.status.changed',
      'assurance_action.created',
      'assurance_action.assigned',
      'assurance_action.acknowledged',
      'assurance_action.snoozed',
      'assessment.question.created',
      'assessment.question.revised',
      'assessment.question.status.changed',
      'assessment.blueprint.created',
      'assessment.blueprint.revised',
      'assessment.blueprint.status.changed',
      'assessment.form.generated'
    )
  );

CREATE TABLE IF NOT EXISTS assessment_blueprints (
  blueprint_id TEXT PRIMARY KEY CHECK (blueprint_id ~ '^assessment_blueprint_[A-Za-z0-9_-]{24}$'),
  blueprint_reference TEXT NOT NULL UNIQUE CHECK (
    char_length(blueprint_reference) BETWEEN 2 AND 120 AND blueprint_reference = btrim(blueprint_reference)
  ),
  blueprint_status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK (blueprint_status IN ('ACTIVE','INACTIVE')),
  current_version_id TEXT NULL CHECK (
    current_version_id IS NULL OR current_version_id ~ '^blueprint_version_[A-Za-z0-9_-]{24}$'
  ),
  created_by_account_id TEXT NOT NULL CHECK (char_length(created_by_account_id) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (blueprint_status = 'INACTIVE' OR current_version_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS assessment_blueprints_status_idx
  ON assessment_blueprints (blueprint_status, updated_at DESC, blueprint_id);

CREATE TABLE IF NOT EXISTS assessment_blueprint_versions (
  blueprint_version_id TEXT PRIMARY KEY CHECK (blueprint_version_id ~ '^blueprint_version_[A-Za-z0-9_-]{24}$'),
  blueprint_id TEXT NOT NULL REFERENCES assessment_blueprints(blueprint_id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  framework_id TEXT NOT NULL CHECK (framework_id ~ '^framework_[A-Za-z0-9_-]{24}$'),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200 AND title = btrim(title)),
  selectors_json JSONB NOT NULL CHECK (
    jsonb_typeof(selectors_json) = 'array' AND jsonb_array_length(selectors_json) BETWEEN 1 AND 500
  ),
  created_by_account_id TEXT NOT NULL CHECK (char_length(created_by_account_id) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (blueprint_id, version_no)
);
CREATE INDEX IF NOT EXISTS assessment_blueprint_versions_framework_idx
  ON assessment_blueprint_versions (framework_id, created_at DESC, blueprint_version_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessment_blueprint_versions_identity_uq'
  ) THEN
    ALTER TABLE assessment_blueprint_versions
      ADD CONSTRAINT assessment_blueprint_versions_identity_uq
      UNIQUE (blueprint_id, blueprint_version_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessment_blueprints_current_version_fk'
  ) THEN
    ALTER TABLE assessment_blueprints
      ADD CONSTRAINT assessment_blueprints_current_version_fk
      FOREIGN KEY (blueprint_id, current_version_id)
      REFERENCES assessment_blueprint_versions (blueprint_id, blueprint_version_id)
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessment_question_versions_identity_uq'
  ) THEN
    ALTER TABLE assessment_question_versions
      ADD CONSTRAINT assessment_question_versions_identity_uq
      UNIQUE (question_id, question_version_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessment_questions_current_version_fk'
  ) THEN
    ALTER TABLE assessment_questions
      ADD CONSTRAINT assessment_questions_current_version_fk
      FOREIGN KEY (question_id, current_version_id)
      REFERENCES assessment_question_versions (question_id, question_version_id)
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS generated_assessment_forms (
  form_id TEXT PRIMARY KEY CHECK (form_id ~ '^assessment_form_[A-Za-z0-9_-]{24}$'),
  case_id TEXT NOT NULL CHECK (case_id ~ '^assurance_case_[A-Za-z0-9_-]{24}$'),
  worker_account_id TEXT NOT NULL CHECK (char_length(worker_account_id) BETWEEN 8 AND 160),
  blueprint_version_id TEXT NOT NULL REFERENCES assessment_blueprint_versions(blueprint_version_id) ON DELETE RESTRICT,
  generation_nonce_hex TEXT NOT NULL CHECK (
    char_length(generation_nonce_hex) = 64 AND generation_nonce_hex ~ '^[a-f0-9]{64}$'
  ),
  question_count INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 500),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (case_id, blueprint_version_id),
  UNIQUE (form_id, worker_account_id)
);
CREATE INDEX IF NOT EXISTS generated_assessment_forms_worker_idx
  ON generated_assessment_forms (worker_account_id, generated_at DESC, form_id);

CREATE TABLE IF NOT EXISTS generated_assessment_form_items (
  form_item_id TEXT PRIMARY KEY CHECK (form_item_id ~ '^assessment_form_item_[A-Za-z0-9_-]{24}$'),
  form_id TEXT NOT NULL REFERENCES generated_assessment_forms(form_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL CHECK (char_length(worker_account_id) BETWEEN 8 AND 160),
  position INTEGER NOT NULL CHECK (position > 0 AND position <= 500),
  question_id TEXT NOT NULL REFERENCES assessment_questions(question_id) ON DELETE RESTRICT,
  question_version_id TEXT NOT NULL REFERENCES assessment_question_versions(question_version_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (form_id, position),
  UNIQUE (form_id, question_id),
  UNIQUE (worker_account_id, question_id)
);
CREATE INDEX IF NOT EXISTS generated_assessment_form_items_question_idx
  ON generated_assessment_form_items (question_id, form_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generated_assessment_form_items_form_worker_fk'
  ) THEN
    ALTER TABLE generated_assessment_form_items
      ADD CONSTRAINT generated_assessment_form_items_form_worker_fk
      FOREIGN KEY (form_id, worker_account_id)
      REFERENCES generated_assessment_forms (form_id, worker_account_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generated_assessment_form_items_question_version_fk'
  ) THEN
    ALTER TABLE generated_assessment_form_items
      ADD CONSTRAINT generated_assessment_form_items_question_version_fk
      FOREIGN KEY (question_id, question_version_id)
      REFERENCES assessment_question_versions (question_id, question_version_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION hse_assessment_blueprint_version_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Assessment blueprint version history is append-only.' USING ERRCODE = '55000';
END; $$;
DROP TRIGGER IF EXISTS assessment_blueprint_versions_append_only ON assessment_blueprint_versions;
CREATE TRIGGER assessment_blueprint_versions_append_only BEFORE UPDATE OR DELETE ON assessment_blueprint_versions FOR EACH ROW EXECUTE FUNCTION hse_assessment_blueprint_version_append_only();

CREATE OR REPLACE FUNCTION hse_generated_assessment_form_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Generated assessment form history is append-only.' USING ERRCODE = '55000';
END; $$;
DROP TRIGGER IF EXISTS generated_assessment_forms_append_only ON generated_assessment_forms;
CREATE TRIGGER generated_assessment_forms_append_only BEFORE UPDATE OR DELETE ON generated_assessment_forms FOR EACH ROW EXECUTE FUNCTION hse_generated_assessment_form_append_only();

DROP TRIGGER IF EXISTS generated_assessment_form_items_append_only ON generated_assessment_form_items;
CREATE TRIGGER generated_assessment_form_items_append_only BEFORE UPDATE OR DELETE ON generated_assessment_form_items FOR EACH ROW EXECUTE FUNCTION hse_generated_assessment_form_append_only();

CREATE OR REPLACE FUNCTION hse_generated_assessment_form_item_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_count INTEGER;
  existing_count INTEGER;
  parent_worker_account_id TEXT;
BEGIN
  SELECT question_count, worker_account_id
    INTO expected_count, parent_worker_account_id
  FROM generated_assessment_forms
  WHERE form_id = NEW.form_id
  FOR UPDATE;

  IF expected_count IS NULL OR parent_worker_account_id IS NULL THEN
    RAISE EXCEPTION 'Generated assessment form is unavailable.' USING ERRCODE = '23503';
  END IF;

  -- Exposure identity is database-derived from the immutable parent form. Callers cannot choose it.
  NEW.worker_account_id := parent_worker_account_id;

  SELECT COUNT(*)::INTEGER
    INTO existing_count
  FROM generated_assessment_form_items
  WHERE form_id = NEW.form_id;

  IF existing_count >= expected_count THEN
    RAISE EXCEPTION 'Generated assessment form already contains its immutable question count.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.position <> existing_count + 1 THEN
    RAISE EXCEPTION 'Generated assessment form item positions must be contiguous and ordered.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generated_assessment_form_items_insert_guard
  ON generated_assessment_form_items;
CREATE TRIGGER generated_assessment_form_items_insert_guard
BEFORE INSERT ON generated_assessment_form_items
FOR EACH ROW
EXECUTE FUNCTION hse_generated_assessment_form_item_insert_guard();

CREATE OR REPLACE FUNCTION hse_generated_assessment_form_complete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  item_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
    INTO item_count
  FROM generated_assessment_form_items
  WHERE form_id = NEW.form_id;

  IF item_count <> NEW.question_count THEN
    RAISE EXCEPTION 'Generated assessment form is incomplete: persisted item count must equal question count.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generated_assessment_forms_complete_guard
  ON generated_assessment_forms;
CREATE CONSTRAINT TRIGGER generated_assessment_forms_complete_guard
AFTER INSERT ON generated_assessment_forms
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION hse_generated_assessment_form_complete_guard();
