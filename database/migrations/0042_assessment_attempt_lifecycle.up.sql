-- M2.07 Candidate Assessment Window.
-- Durable Worker-owned attempts and immutable committed answers over pinned M2.05 form items.

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
      'assessment.form.generated',
      'assessment.catalogue.created',
      'assessment.catalogue.revised',
      'assessment.catalogue.status.changed',
      'assessment.attempt.started',
      'assessment.attempt.submitted'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessment_catalogue_versions_attempt_lineage_uq'
  ) THEN
    ALTER TABLE assessment_catalogue_versions
      ADD CONSTRAINT assessment_catalogue_versions_attempt_lineage_uq
      UNIQUE (catalogue_version_id, blueprint_version_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generated_assessment_forms_attempt_lineage_uq'
  ) THEN
    ALTER TABLE generated_assessment_forms
      ADD CONSTRAINT generated_assessment_forms_attempt_lineage_uq
      UNIQUE (form_id, case_id, worker_account_id, blueprint_version_id, question_count);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generated_assessment_form_items_form_item_uq'
  ) THEN
    ALTER TABLE generated_assessment_form_items
      ADD CONSTRAINT generated_assessment_form_items_form_item_uq
      UNIQUE (form_id, form_item_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generated_assessment_form_items_answer_lineage_uq'
  ) THEN
    ALTER TABLE generated_assessment_form_items
      ADD CONSTRAINT generated_assessment_form_items_answer_lineage_uq
      UNIQUE (form_id, form_item_id, position, question_id, question_version_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessment_question_versions_answer_type_uq'
  ) THEN
    ALTER TABLE assessment_question_versions
      ADD CONSTRAINT assessment_question_versions_answer_type_uq
      UNIQUE (question_id, question_version_id, question_type);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS assessment_attempts (
  attempt_id TEXT PRIMARY KEY CHECK (
    attempt_id ~ '^assessment_attempt_[A-Za-z0-9_-]{24}$'
  ),
  case_id TEXT NOT NULL
    REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL
    REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  catalogue_version_id TEXT NOT NULL
    REFERENCES assessment_catalogue_versions(catalogue_version_id) ON DELETE RESTRICT,
  blueprint_version_id TEXT NOT NULL
    REFERENCES assessment_blueprint_versions(blueprint_version_id) ON DELETE RESTRICT,
  form_id TEXT NOT NULL
    REFERENCES generated_assessment_forms(form_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUBMITTED')),
  current_position INTEGER NOT NULL,
  question_count INTEGER NOT NULL CHECK (question_count >= 1 AND question_count <= 500),
  started_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (current_position BETWEEN 1 AND question_count),
  CHECK (
    (status = 'IN_PROGRESS' AND submitted_at IS NULL) OR
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL AND current_position = question_count)
  ),
  UNIQUE (form_id),
  UNIQUE (attempt_id, form_id),
  CONSTRAINT assessment_attempts_catalogue_blueprint_fk
    FOREIGN KEY (catalogue_version_id, blueprint_version_id)
    REFERENCES assessment_catalogue_versions (catalogue_version_id, blueprint_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT assessment_attempts_form_lineage_fk
    FOREIGN KEY (form_id, case_id, worker_account_id, blueprint_version_id, question_count)
    REFERENCES generated_assessment_forms (
      form_id, case_id, worker_account_id, blueprint_version_id, question_count
    )
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS assessment_attempts_worker_idx
  ON assessment_attempts (worker_account_id, status, updated_at DESC, attempt_id);
CREATE INDEX IF NOT EXISTS assessment_attempts_case_idx
  ON assessment_attempts (case_id, created_at DESC, attempt_id);

CREATE TABLE IF NOT EXISTS assessment_attempt_answers (
  answer_id TEXT PRIMARY KEY CHECK (
    answer_id ~ '^assessment_answer_[A-Za-z0-9_-]{24}$'
  ),
  attempt_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  form_item_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0 AND position <= 500),
  question_id TEXT NOT NULL
    REFERENCES assessment_questions(question_id) ON DELETE RESTRICT,
  question_version_id TEXT NOT NULL
    REFERENCES assessment_question_versions(question_version_id) ON DELETE RESTRICT,
  question_type TEXT NOT NULL CHECK (
    question_type IN (
      'MULTIPLE_CHOICE',
      'TRUE_FALSE',
      'SHORT_TEXT',
      'LONG_TEXT',
      'INTEGER',
      'DECIMAL'
    )
  ),
  text_value TEXT NULL,
  boolean_value BOOLEAN NULL,
  numeric_value NUMERIC NULL,
  committed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (attempt_id, position),
  CONSTRAINT assessment_attempt_answers_attempt_form_fk
    FOREIGN KEY (attempt_id, form_id)
    REFERENCES assessment_attempts (attempt_id, form_id)
    ON DELETE RESTRICT,
  CONSTRAINT assessment_attempt_answers_form_item_fk
    FOREIGN KEY (form_id, form_item_id)
    REFERENCES generated_assessment_form_items (form_id, form_item_id)
    ON DELETE RESTRICT,
  CONSTRAINT assessment_attempt_answers_item_lineage_fk
    FOREIGN KEY (form_id, form_item_id, position, question_id, question_version_id)
    REFERENCES generated_assessment_form_items (
      form_id, form_item_id, position, question_id, question_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT assessment_attempt_answers_question_type_fk
    FOREIGN KEY (question_id, question_version_id, question_type)
    REFERENCES assessment_question_versions (question_id, question_version_id, question_type)
    ON DELETE RESTRICT,
  CHECK (
    (question_type = 'MULTIPLE_CHOICE' AND text_value IS NOT NULL AND boolean_value IS NULL AND numeric_value IS NULL) OR
    (question_type = 'TRUE_FALSE' AND boolean_value IS NOT NULL AND text_value IS NULL AND numeric_value IS NULL) OR
    (question_type IN ('SHORT_TEXT', 'LONG_TEXT') AND text_value IS NOT NULL AND boolean_value IS NULL AND numeric_value IS NULL) OR
    (question_type IN ('INTEGER', 'DECIMAL') AND numeric_value IS NOT NULL AND text_value IS NULL AND boolean_value IS NULL)
  ),
  CHECK (
    question_type <> 'SHORT_TEXT' OR (
      char_length(text_value) BETWEEN 1 AND 2000 AND text_value = btrim(text_value)
    )
  ),
  CHECK (
    question_type <> 'LONG_TEXT' OR (
      char_length(text_value) BETWEEN 1 AND 20000 AND text_value = btrim(text_value)
    )
  ),
  CHECK (
    question_type <> 'MULTIPLE_CHOICE' OR (
      char_length(text_value) >= 1 AND text_value = btrim(text_value)
    )
  ),
  CHECK (
    question_type <> 'INTEGER' OR (
      numeric_value = trunc(numeric_value) AND
      numeric_value BETWEEN -9007199254740991 AND 9007199254740991
    )
  ),
  CHECK (
    question_type <> 'DECIMAL' OR numeric_value::text NOT IN ('NaN', 'Infinity', '-Infinity')
  )
);

CREATE INDEX IF NOT EXISTS assessment_attempt_answers_attempt_idx
  ON assessment_attempt_answers (attempt_id, position);

CREATE OR REPLACE FUNCTION hse_assessment_attempt_answer_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Committed assessment answers are append-only.' USING ERRCODE = '55000';
END; $$;

DROP TRIGGER IF EXISTS assessment_attempt_answers_append_only ON assessment_attempt_answers;
CREATE TRIGGER assessment_attempt_answers_append_only
BEFORE UPDATE OR DELETE ON assessment_attempt_answers
FOR EACH ROW
EXECUTE FUNCTION hse_assessment_attempt_answer_append_only();
