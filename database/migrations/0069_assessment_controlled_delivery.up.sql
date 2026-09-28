-- Masterplan completion: controlled assessment delivery, recovery and review modes.

-- Preserve the original generated form but permit explicit replacement generations.
ALTER TABLE generated_assessment_forms
  DROP CONSTRAINT IF EXISTS generated_assessment_forms_case_id_blueprint_version_id_key;
ALTER TABLE generated_assessment_forms
  ADD COLUMN IF NOT EXISTS generation_sequence INTEGER NOT NULL DEFAULT 1
    CHECK (generation_sequence >= 1),
  ADD COLUMN IF NOT EXISTS generation_kind TEXT NOT NULL DEFAULT 'INITIAL'
    CHECK (generation_kind IN ('INITIAL','REPLACEMENT')),
  ADD COLUMN IF NOT EXISTS replaces_form_id TEXT NULL
    CHECK (replaces_form_id IS NULL OR replaces_form_id ~ '^assessment_form_[A-Za-z0-9_-]{24}$');
CREATE UNIQUE INDEX IF NOT EXISTS generated_assessment_forms_case_generation_uidx
  ON generated_assessment_forms(case_id,blueprint_version_id,generation_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS generated_assessment_forms_initial_uidx
  ON generated_assessment_forms(case_id,blueprint_version_id)
  WHERE generation_kind='INITIAL';
CREATE INDEX IF NOT EXISTS generated_assessment_forms_replacement_idx
  ON generated_assessment_forms(replaces_form_id)
  WHERE replaces_form_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS assessment_blueprint_delivery_settings (
  blueprint_version_id TEXT PRIMARY KEY
    REFERENCES assessment_blueprint_versions(blueprint_version_id) ON DELETE RESTRICT,
  progression_mode TEXT NOT NULL DEFAULT 'STRICT'
    CHECK (progression_mode IN ('STRICT','CONTROLLED_REVIEW','SECTION_REVIEW')),
  section_config_json JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(section_config_json)='array'),
  require_camera BOOLEAN NOT NULL DEFAULT FALSE,
  require_microphone BOOLEAN NOT NULL DEFAULT FALSE,
  require_screen_share BOOLEAN NOT NULL DEFAULT FALSE,
  record_camera BOOLEAN NOT NULL DEFAULT FALSE,
  record_microphone BOOLEAN NOT NULL DEFAULT FALSE,
  record_screen BOOLEAN NOT NULL DEFAULT FALSE,
  recording_retention_days INTEGER NOT NULL DEFAULT 30
    CHECK (recording_retention_days BETWEEN 1 AND 3650),
  integrity_failure_mode TEXT NOT NULL DEFAULT 'REVIEW'
    CHECK (integrity_failure_mode IN ('REVIEW','BLOCK')),
  require_fullscreen BOOLEAN NOT NULL DEFAULT TRUE,
  require_environment_declaration BOOLEAN NOT NULL DEFAULT TRUE,
  require_monitoring_consent BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (NOT record_camera OR require_camera),
  CHECK (NOT record_microphone OR require_microphone),
  CHECK (NOT record_screen OR require_screen_share)
);

CREATE TABLE IF NOT EXISTS assessment_precheck_records (
  precheck_id TEXT PRIMARY KEY CHECK (precheck_id ~ '^assessment_precheck_[A-Za-z0-9_-]{24}$'),
  case_id TEXT NOT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  catalogue_version_id TEXT NOT NULL
    REFERENCES assessment_catalogue_versions(catalogue_version_id) ON DELETE RESTRICT,
  blueprint_version_id TEXT NOT NULL
    REFERENCES assessment_blueprint_versions(blueprint_version_id) ON DELETE RESTRICT,
  auth_session_id TEXT NOT NULL REFERENCES auth_sessions(session_id) ON DELETE RESTRICT,
  device_token_hash TEXT NOT NULL CHECK (char_length(device_token_hash) BETWEEN 32 AND 180),
  supported_browser BOOLEAN NOT NULL,
  connection_ok BOOLEAN NOT NULL,
  camera_ok BOOLEAN NOT NULL,
  microphone_ok BOOLEAN NOT NULL,
  screen_share_ok BOOLEAN NOT NULL,
  fullscreen_capable BOOLEAN NOT NULL,
  identity_reconfirmed BOOLEAN NOT NULL,
  environment_declared BOOLEAN NOT NULL,
  monitoring_consented BOOLEAN NOT NULL,
  passed BOOLEAN NOT NULL,
  diagnostics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS assessment_precheck_worker_idx
  ON assessment_precheck_records(worker_account_id,case_id,created_at DESC);

CREATE TABLE IF NOT EXISTS assessment_attempt_bindings (
  attempt_id TEXT PRIMARY KEY REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  device_token_hash TEXT NOT NULL CHECK (char_length(device_token_hash) BETWEEN 32 AND 180),
  initial_auth_session_id TEXT NOT NULL REFERENCES auth_sessions(session_id) ON DELETE RESTRICT,
  current_auth_session_id TEXT NOT NULL REFERENCES auth_sessions(session_id) ON DELETE RESTRICT,
  security_context_hash TEXT NOT NULL CHECK (char_length(security_context_hash) BETWEEN 32 AND 180),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS assessment_attempt_bindings_worker_idx
  ON assessment_attempt_bindings(worker_account_id,last_verified_at DESC);

CREATE TABLE IF NOT EXISTS assessment_interruption_events (
  interruption_id TEXT PRIMARY KEY CHECK (interruption_id ~ '^assessment_interrupt_[A-Za-z0-9_-]{24}$'),
  attempt_id TEXT NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (reason IN (
    'emergency_exit','connection_lost','device_changed','browser_closed',
    'technical_issue','permission_lost','session_expired'
  )),
  detail TEXT NULL CHECK (detail IS NULL OR char_length(detail) <= 1000),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolution TEXT NULL CHECK (resolution IS NULL OR resolution IN (
    'RESUMED','REVIEW_REQUIRED','INVALIDATED','REPLACED'
  )),
  resolved_at TIMESTAMPTZ NULL,
  CHECK (
    (resolution IS NULL AND resolved_at IS NULL) OR
    (resolution IS NOT NULL AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS assessment_interruption_attempt_idx
  ON assessment_interruption_events(attempt_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS assessment_recovery_reviews (
  review_id TEXT PRIMARY KEY CHECK (review_id ~ '^assessment_recovery_[A-Za-z0-9_-]{24}$'),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  request_reason TEXT NOT NULL CHECK (char_length(trim(request_reason)) BETWEEN 10 AND 2000),
  review_status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (review_status IN ('QUEUED','CLAIMED','APPROVED_REPLACEMENT','RESUME_ALLOWED')),
  claimed_by_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  claimed_at TIMESTAMPTZ NULL,
  decision_reason TEXT NULL CHECK (decision_reason IS NULL OR char_length(trim(decision_reason)) BETWEEN 10 AND 2000),
  decided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (review_status='QUEUED' AND claimed_by_account_id IS NULL AND claimed_at IS NULL AND decision_reason IS NULL AND decided_at IS NULL) OR
    (review_status='CLAIMED' AND claimed_by_account_id IS NOT NULL AND claimed_at IS NOT NULL AND decision_reason IS NULL AND decided_at IS NULL) OR
    (review_status IN ('APPROVED_REPLACEMENT','RESUME_ALLOWED')
      AND claimed_by_account_id IS NOT NULL AND claimed_at IS NOT NULL
      AND decision_reason IS NOT NULL AND decided_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS assessment_recovery_reviews_queue_idx
  ON assessment_recovery_reviews(review_status,created_at,review_id);

CREATE TABLE IF NOT EXISTS assessment_replacement_authorizations (
  authorization_id TEXT PRIMARY KEY CHECK (authorization_id ~ '^replacement_auth_[A-Za-z0-9_-]{24}$'),
  recovery_review_id TEXT NOT NULL UNIQUE REFERENCES assessment_recovery_reviews(review_id) ON DELETE RESTRICT,
  original_attempt_id TEXT NOT NULL UNIQUE REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  replacement_form_id TEXT NULL UNIQUE REFERENCES generated_assessment_forms(form_id) ON DELETE RESTRICT,
  approved_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 2000),
  status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED','CONSUMED','REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TIMESTAMPTZ NULL,
  CHECK (
    (status='CONSUMED' AND consumed_at IS NOT NULL AND replacement_form_id IS NOT NULL) OR
    (status<>'CONSUMED' AND consumed_at IS NULL AND replacement_form_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS assessment_attempt_replacements (
  replacement_id TEXT PRIMARY KEY CHECK (replacement_id ~ '^assessment_replacement_[A-Za-z0-9_-]{24}$'),
  original_attempt_id TEXT NOT NULL UNIQUE REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  replacement_attempt_id TEXT NOT NULL UNIQUE REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  original_form_id TEXT NOT NULL REFERENCES generated_assessment_forms(form_id) ON DELETE RESTRICT,
  replacement_form_id TEXT NOT NULL UNIQUE REFERENCES generated_assessment_forms(form_id) ON DELETE RESTRICT,
  approved_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (original_attempt_id <> replacement_attempt_id),
  CHECK (original_form_id <> replacement_form_id)
);

CREATE TABLE IF NOT EXISTS assessment_candidate_flags (
  flag_id TEXT PRIMARY KEY CHECK (flag_id ~ '^assessment_flag_[A-Za-z0-9_-]{24}$'),
  attempt_id TEXT NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position > 0 AND position <= 500),
  flagged BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attempt_id,position)
);

CREATE TABLE IF NOT EXISTS assessment_answer_revisions (
  revision_id TEXT PRIMARY KEY CHECK (revision_id ~ '^assessment_revision_[A-Za-z0-9_-]{24}$'),
  attempt_id TEXT NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  answer_id TEXT NOT NULL REFERENCES assessment_attempt_answers(answer_id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position > 0 AND position <= 500),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  text_value TEXT NULL,
  boolean_value BOOLEAN NULL,
  numeric_value NUMERIC NULL,
  revised_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attempt_id,position,revision_no)
);
CREATE INDEX IF NOT EXISTS assessment_answer_revisions_latest_idx
  ON assessment_answer_revisions(attempt_id,position,revision_no DESC);

CREATE TABLE IF NOT EXISTS assessment_section_locks (
  attempt_id TEXT NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  section_index INTEGER NOT NULL CHECK (section_index >= 1),
  start_position INTEGER NOT NULL CHECK (start_position >= 1),
  end_position INTEGER NOT NULL CHECK (end_position >= start_position),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(attempt_id,section_index)
);

ALTER TABLE assessment_attempts
  DROP CONSTRAINT IF EXISTS assessment_attempts_status_check;
ALTER TABLE assessment_attempts
  ADD CONSTRAINT assessment_attempts_status_check CHECK (
    status IN ('IN_PROGRESS','INTERRUPTED','REVIEW_REQUIRED','INVALIDATED','REPLACED','SUBMITTED')
  );
ALTER TABLE assessment_attempts
  DROP CONSTRAINT IF EXISTS assessment_attempts_completion_state_check;
ALTER TABLE assessment_attempts
  ADD CONSTRAINT assessment_attempts_completion_state_check CHECK (
    (status IN ('IN_PROGRESS','INTERRUPTED','REVIEW_REQUIRED','INVALIDATED','REPLACED') AND submitted_at IS NULL) OR
    (status='SUBMITTED' AND submitted_at IS NOT NULL AND current_position=question_count)
  );

ALTER TABLE platform_audit_events
  DROP CONSTRAINT IF EXISTS platform_audit_events_action_key_check;
ALTER TABLE platform_audit_events
  ADD CONSTRAINT platform_audit_events_action_key_check CHECK (
    action_key IN (
      'authentication.registration.started','authentication.otp.issued','authentication.otp.failed','authentication.otp.verified','authentication.password.created','authentication.password_reset.requested','authentication.password_reset.completed','authentication.login.failed','authentication.login.succeeded','authentication.logout','authentication.session.revoked','authentication.account.locked','authentication.account.unlocked','authentication.invitation.created','authentication.invitation.accepted','authentication.mfa.enrolled','authentication.mfa.failed','authentication.mfa.succeeded','authorization.access.denied','outbox.job.enqueued','outbox.job.claimed','outbox.job.lease_reclaimed','outbox.job.succeeded','outbox.job.retry_scheduled','outbox.job.terminal_failed','notification.projected','notification.read','notification.deep_link.denied','email.delivery.queued','email.delivery.attempt.started','email.delivery.delivered','email.delivery.retry_scheduled','email.delivery.terminal_failed','secure_file.quarantined','secure_file.scan.queued','secure_file.scan.available','secure_file.scan.unsafe','secure_file.scan.failed','secure_file.access.authorized','secure_file.access.served','worker_identity.created','worker_identity.status.changed','worker_identity.duplicate.evaluated','worker_identity.duplicate.disposition.recorded','worker_identity.worker_id.issued','company_verification.updated','company_verification.evidence.bound','company_verification.submitted','company_verification.withdrawn','company_verification.status.changed','company_organization.created','company_organization.updated','company_organization.archived','company_organization.restored','company_team.invitation.created','company_team.invitation.revoked','company_team.membership.updated','company_team.membership.suspended','company_team.membership.reactivated','company_team.membership.revoked','company_workforce.invitation.created','company_workforce.invitation.resent','company_workforce.invitation.revoked','company_workforce.invitation.accepted','company_workforce.code.created','company_workforce.code.revoked','company_workforce.code.redeemed','company_workforce.link.requested','company_workforce.link.accepted','company_workforce.link.revoked','worker_evidence.record.created','worker_evidence.draft.saved','worker_evidence.file.attached','worker_evidence.file.replaced','worker_evidence.version.submitted','worker_evidence.revision.started','worker_evidence.employment.ended','worker_evidence.skill.inactivated','worker_evidence.leaving_letter.attached','worker_evidence.leaving_letter.replaced','public_verification.concern.received','assurance_order.created','assurance_order.updated','assurance_order.validated','assurance_order.submitted','assurance_order.cancelled','assurance_case.created','assurance_case.status.changed','assurance_action.created','assurance_action.assigned','assurance_action.acknowledged','assurance_action.snoozed','assessment.question.created','assessment.question.revised','assessment.question.status.changed','assessment.blueprint.created','assessment.blueprint.revised','assessment.blueprint.status.changed','assessment.form.generated','assessment.catalogue.created','assessment.catalogue.revised','assessment.catalogue.status.changed','assessment.attempt.started','assessment.attempt.submitted','decision.created','decision.override.created','production_launch.handover.updated','billing.checkout.created','billing.refund.requested','billing.reconciliation.completed','billing.subscription.started','billing.subscription.cancelled',
      'assessment.precheck.completed',
      'assessment.attempt.interrupted',
      'assessment.recovery.requested',
      'assessment.replacement.approved',
      'assessment.attempt.resumed',
      'assessment.attempt.replaced'
    )
  );
