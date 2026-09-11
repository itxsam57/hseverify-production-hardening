-- Roll back only M2.07 Candidate Assessment Window persistence objects.
-- Existing append-only M2.07 audit history is preserved. The restored pre-M2.07
-- action constraint is NOT VALID so historical attempt events remain readable,
-- while all new/updated rows are immediately checked against the older vocabulary.

DROP TABLE IF EXISTS assessment_attempt_answers;
DROP FUNCTION IF EXISTS hse_assessment_attempt_answer_append_only();
DROP TABLE IF EXISTS assessment_attempts;

ALTER TABLE assessment_question_versions
  DROP CONSTRAINT IF EXISTS assessment_question_versions_answer_type_uq;
ALTER TABLE generated_assessment_form_items
  DROP CONSTRAINT IF EXISTS generated_assessment_form_items_answer_lineage_uq;
ALTER TABLE generated_assessment_form_items
  DROP CONSTRAINT IF EXISTS generated_assessment_form_items_form_item_uq;
ALTER TABLE generated_assessment_forms
  DROP CONSTRAINT IF EXISTS generated_assessment_forms_attempt_lineage_uq;
ALTER TABLE assessment_catalogue_versions
  DROP CONSTRAINT IF EXISTS assessment_catalogue_versions_attempt_lineage_uq;

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
  ) NOT VALID;
