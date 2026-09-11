-- M2.06 Assessment Catalogue and Eligibility.
-- Stable catalogue entries point to immutable versions which pin an exact M2.05 blueprint version.

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
      'assessment.catalogue.status.changed'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessment_blueprint_versions_framework_identity_uq'
  ) THEN
    ALTER TABLE assessment_blueprint_versions
      ADD CONSTRAINT assessment_blueprint_versions_framework_identity_uq
      UNIQUE (framework_id, blueprint_version_id);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS assessment_catalogue_entries (
  catalogue_entry_id TEXT PRIMARY KEY CHECK (
    catalogue_entry_id ~ '^assessment_catalogue_[A-Za-z0-9_-]{24}$'
  ),
  catalogue_reference TEXT NOT NULL UNIQUE CHECK (
    char_length(catalogue_reference) BETWEEN 2 AND 120 AND
    catalogue_reference = btrim(catalogue_reference)
  ),
  catalogue_status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK (
    catalogue_status IN ('ACTIVE','INACTIVE')
  ),
  current_version_id TEXT NULL CHECK (
    current_version_id IS NULL OR
    current_version_id ~ '^catalogue_version_[A-Za-z0-9_-]{24}$'
  ),
  created_by_account_id TEXT NOT NULL CHECK (
    char_length(created_by_account_id) BETWEEN 8 AND 160
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (catalogue_status = 'INACTIVE' OR current_version_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS assessment_catalogue_entries_status_idx
  ON assessment_catalogue_entries (catalogue_status, updated_at DESC, catalogue_entry_id);

CREATE TABLE IF NOT EXISTS assessment_catalogue_versions (
  catalogue_version_id TEXT PRIMARY KEY CHECK (
    catalogue_version_id ~ '^catalogue_version_[A-Za-z0-9_-]{24}$'
  ),
  catalogue_entry_id TEXT NOT NULL
    REFERENCES assessment_catalogue_entries(catalogue_entry_id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  title TEXT NOT NULL CHECK (
    char_length(title) BETWEEN 2 AND 200 AND title = btrim(title)
  ),
  description TEXT NULL CHECK (
    description IS NULL OR (
      char_length(description) BETWEEN 1 AND 2000 AND description = btrim(description)
    )
  ),
  framework_id TEXT NOT NULL CHECK (
    framework_id ~ '^framework_[A-Za-z0-9_-]{24}$'
  ),
  blueprint_version_id TEXT NOT NULL CHECK (
    blueprint_version_id ~ '^blueprint_version_[A-Za-z0-9_-]{24}$'
  ),
  minimum_verified_qualifications INTEGER NOT NULL DEFAULT 1
    CHECK (minimum_verified_qualifications BETWEEN 0 AND 50),
  created_by_account_id TEXT NOT NULL CHECK (
    char_length(created_by_account_id) BETWEEN 8 AND 160
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (catalogue_entry_id, version_no),
  UNIQUE (catalogue_entry_id, catalogue_version_id),
  CONSTRAINT assessment_catalogue_versions_blueprint_framework_fk
    FOREIGN KEY (framework_id, blueprint_version_id)
    REFERENCES assessment_blueprint_versions (framework_id, blueprint_version_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS assessment_catalogue_versions_framework_idx
  ON assessment_catalogue_versions (
    framework_id, blueprint_version_id, created_at DESC, catalogue_version_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessment_catalogue_entries_current_version_fk'
  ) THEN
    ALTER TABLE assessment_catalogue_entries
      ADD CONSTRAINT assessment_catalogue_entries_current_version_fk
      FOREIGN KEY (catalogue_entry_id, current_version_id)
      REFERENCES assessment_catalogue_versions (
        catalogue_entry_id, catalogue_version_id
      )
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION hse_assessment_catalogue_version_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Assessment catalogue version history is append-only.'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS assessment_catalogue_versions_append_only
  ON assessment_catalogue_versions;
CREATE TRIGGER assessment_catalogue_versions_append_only
BEFORE UPDATE OR DELETE ON assessment_catalogue_versions
FOR EACH ROW
EXECUTE FUNCTION hse_assessment_catalogue_version_append_only();
