-- M2.01 Assurance Order and Case Engine.
--
-- This brick owns Assurance Order request history, worker targets, worker-specific
-- Assurance Cases, append-only case timeline and the Company Action Centre.
-- Earlier-brick identifiers are deliberately opaque references rather than hard
-- foreign keys. Trusted services revalidate tenant, membership, Company
-- verification, site/department and company_worker_links at command time. This
-- keeps retained M2.01 history independent from lower-brick rollback/reapply.

ALTER TABLE platform_audit_events
  DROP CONSTRAINT IF EXISTS platform_audit_events_action_key_check;
ALTER TABLE platform_audit_events
  ADD CONSTRAINT platform_audit_events_action_key_check CHECK (
    action_key IN (
      'authentication.registration.started','authentication.otp.issued','authentication.otp.failed',
      'authentication.otp.verified','authentication.password.created','authentication.password_reset.requested',
      'authentication.password_reset.completed','authentication.login.failed','authentication.login.succeeded',
      'authentication.logout','authentication.session.revoked','authentication.account.locked',
      'authentication.account.unlocked','authentication.invitation.created','authentication.invitation.accepted',
      'authentication.mfa.enrolled','authentication.mfa.failed','authentication.mfa.succeeded',
      'authorization.access.denied','outbox.job.enqueued','outbox.job.claimed','outbox.job.lease_reclaimed',
      'outbox.job.succeeded','outbox.job.retry_scheduled','outbox.job.terminal_failed',
      'notification.projected','notification.read','notification.deep_link.denied',
      'email.delivery.queued','email.delivery.attempt.started','email.delivery.delivered',
      'email.delivery.retry_scheduled','email.delivery.terminal_failed',
      'secure_file.quarantined','secure_file.scan.queued','secure_file.scan.available','secure_file.scan.unsafe',
      'secure_file.scan.failed','secure_file.access.authorized','secure_file.access.served',
      'worker_identity.created','worker_identity.status.changed','worker_identity.duplicate.evaluated',
      'worker_identity.duplicate.disposition.recorded','worker_identity.worker_id.issued',
      'company_verification.updated','company_verification.evidence.bound','company_verification.submitted',
      'company_verification.withdrawn','company_verification.status.changed',
      'company_organization.created','company_organization.updated','company_organization.archived',
      'company_organization.restored','company_team.invitation.created','company_team.invitation.revoked',
      'company_team.membership.updated','company_team.membership.suspended','company_team.membership.reactivated',
      'company_team.membership.revoked','company_workforce.invitation.created','company_workforce.invitation.resent',
      'company_workforce.invitation.revoked','company_workforce.invitation.accepted','company_workforce.code.created',
      'company_workforce.code.revoked','company_workforce.code.redeemed','company_workforce.link.requested',
      'company_workforce.link.accepted','company_workforce.link.revoked',
      'worker_evidence.record.created','worker_evidence.draft.saved','worker_evidence.file.attached',
      'worker_evidence.file.replaced','worker_evidence.version.submitted','worker_evidence.revision.started',
      'worker_evidence.employment.ended','worker_evidence.skill.inactivated',
      'worker_evidence.leaving_letter.attached','worker_evidence.leaving_letter.replaced',
      'public_verification.concern.received',
      'assurance_order.created','assurance_order.updated','assurance_order.validated',
      'assurance_order.submitted','assurance_order.cancelled','assurance_case.created',
      'assurance_case.status.changed','assurance_action.created','assurance_action.assigned',
      'assurance_action.acknowledged','assurance_action.snoozed'
    )
  );

CREATE TABLE IF NOT EXISTS assurance_orders (
  order_id TEXT PRIMARY KEY CHECK (order_id ~ '^assurance_order_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^tenant_[A-Za-z0-9_-]{24}$'),
  created_by_membership_id TEXT NOT NULL CHECK (char_length(created_by_membership_id) BETWEEN 12 AND 96),
  order_name TEXT NOT NULL CHECK (char_length(order_name) BETWEEN 2 AND 160 AND order_name=btrim(order_name)),
  order_reference TEXT NOT NULL CHECK (char_length(order_reference) BETWEEN 1 AND 120 AND order_reference=btrim(order_reference)),
  site_id TEXT NULL CHECK (site_id IS NULL OR char_length(site_id) BETWEEN 1 AND 80),
  department_id TEXT NULL CHECK (department_id IS NULL OR char_length(department_id) BETWEEN 1 AND 80),
  requested_identity_checks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(requested_identity_checks)='array'),
  requested_evidence_checks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(requested_evidence_checks)='array'),
  assessment_framework_references JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assessment_framework_references)='array'),
  interview_required BOOLEAN NOT NULL DEFAULT FALSE,
  credential_target TEXT NULL CHECK (credential_target IS NULL OR char_length(credential_target) BETWEEN 1 AND 160),
  deadline TIMESTAMPTZ NULL,
  effective_policy_reference TEXT NULL CHECK (effective_policy_reference IS NULL OR char_length(effective_policy_reference) BETWEEN 1 AND 160),
  company_notes TEXT NULL CHECK (company_notes IS NULL OR char_length(company_notes) <= 4000),
  purchase_order_reference TEXT NULL CHECK (purchase_order_reference IS NULL OR char_length(purchase_order_reference) BETWEEN 1 AND 160),
  order_status TEXT NOT NULL DEFAULT 'DRAFT',
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_errors)='array'),
  scope_version INTEGER NOT NULL DEFAULT 1 CHECK (scope_version >= 1),
  submitted_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assurance_orders_status_check CHECK (
    order_status IN ('DRAFT','VALIDATION_FAILED','READY','SUBMITTED','PARTIALLY_FUNDED','ACTIVE','COMPLETED','CANCELLED','CLOSED')
  ),
  CONSTRAINT assurance_orders_submit_state_check CHECK (
    (order_status IN ('DRAFT','VALIDATION_FAILED','READY') AND submitted_at IS NULL AND cancelled_at IS NULL)
    OR (order_status IN ('SUBMITTED','PARTIALLY_FUNDED','ACTIVE','COMPLETED','CLOSED') AND submitted_at IS NOT NULL AND cancelled_at IS NULL)
    OR (order_status='CANCELLED' AND cancelled_at IS NOT NULL)
  ),
  UNIQUE (order_id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS assurance_orders_tenant_reference_live_idx
  ON assurance_orders (tenant_id, lower(order_reference))
  WHERE order_status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS assurance_orders_tenant_status_idx
  ON assurance_orders (tenant_id, order_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS assurance_order_workers (
  target_id TEXT PRIMARY KEY CHECK (target_id ~ '^assurance_target_[A-Za-z0-9_-]{24}$'),
  order_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  worker_link_id TEXT NOT NULL CHECK (char_length(worker_link_id) BETWEEN 12 AND 96),
  worker_account_id TEXT NOT NULL CHECK (char_length(worker_account_id) BETWEEN 12 AND 96),
  permanent_worker_id TEXT NULL CHECK (permanent_worker_id IS NULL OR char_length(permanent_worker_id) BETWEEN 8 AND 120),
  site_id TEXT NULL CHECK (site_id IS NULL OR char_length(site_id) BETWEEN 1 AND 80),
  department_id TEXT NULL CHECK (department_id IS NULL OR char_length(department_id) BETWEEN 1 AND 80),
  funding_method TEXT NOT NULL CHECK (funding_method IN ('company','worker')),
  target_status TEXT NOT NULL DEFAULT 'draft' CHECK (target_status IN ('draft','eligible','ineligible','submitted','cancelled')),
  validation_reason TEXT NULL CHECK (validation_reason IS NULL OR char_length(validation_reason) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id, tenant_id) REFERENCES assurance_orders(order_id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (order_id, worker_account_id),
  UNIQUE (order_id, worker_link_id),
  UNIQUE (target_id, order_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS assurance_order_workers_order_idx
  ON assurance_order_workers (tenant_id, order_id, target_status, created_at);

CREATE TABLE IF NOT EXISTS assurance_cases (
  case_id TEXT PRIMARY KEY CHECK (case_id ~ '^assurance_case_[A-Za-z0-9_-]{24}$'),
  order_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  worker_link_id TEXT NOT NULL CHECK (char_length(worker_link_id) BETWEEN 12 AND 96),
  worker_account_id TEXT NOT NULL CHECK (char_length(worker_account_id) BETWEEN 12 AND 96),
  permanent_worker_id TEXT NULL CHECK (permanent_worker_id IS NULL OR char_length(permanent_worker_id) BETWEEN 8 AND 120),
  case_status TEXT NOT NULL,
  owner_kind TEXT NULL CHECK (owner_kind IS NULL OR owner_kind IN ('worker','company','reviewer','assessor','admin','payment','background_job')),
  next_action TEXT NULL CHECK (next_action IS NULL OR char_length(next_action) BETWEEN 3 AND 500),
  evidence_reference TEXT NULL,
  assessment_reference TEXT NULL,
  integrity_reference TEXT NULL,
  review_reference TEXT NULL,
  interview_reference TEXT NULL,
  decision_reference TEXT NULL,
  credential_reference TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ NULL,
  FOREIGN KEY (order_id, tenant_id) REFERENCES assurance_orders(order_id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (target_id, order_id, tenant_id) REFERENCES assurance_order_workers(target_id, order_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT assurance_cases_status_check CHECK (
    case_status IN ('Created','Awaiting worker acceptance','Identity pending','Evidence pending','Funding pending','Assessment pending','Assessment in progress','Review pending','Interview pending','Decision pending','Approved','Conditionally approved','Reassessment required','Rejected','Suspended','Closed')
  ),
  CONSTRAINT assurance_cases_owner_action_check CHECK (
    (case_status IN ('Approved','Conditionally approved','Rejected','Closed') AND owner_kind IS NULL AND next_action IS NULL)
    OR (case_status NOT IN ('Approved','Conditionally approved','Rejected','Closed') AND owner_kind IS NOT NULL AND next_action IS NOT NULL)
  ),
  UNIQUE (order_id, worker_account_id),
  UNIQUE (case_id, order_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS assurance_cases_action_centre_idx
  ON assurance_cases (tenant_id, owner_kind, case_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS assurance_case_timeline_events (
  timeline_event_id TEXT PRIMARY KEY CHECK (timeline_event_id ~ '^assurance_event_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  case_id TEXT NULL,
  event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 80),
  from_status TEXT NULL CHECK (from_status IS NULL OR char_length(from_status) <= 80),
  to_status TEXT NOT NULL CHECK (char_length(to_status) BETWEEN 1 AND 80),
  owner_kind TEXT NULL CHECK (owner_kind IS NULL OR owner_kind IN ('worker','company','reviewer','assessor','admin','payment','background_job')),
  next_action TEXT NULL CHECK (next_action IS NULL OR char_length(next_action) <= 500),
  actor_account_id TEXT NOT NULL CHECK (char_length(actor_account_id) BETWEEN 8 AND 96),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('worker','company','assessor','verifier','admin','root')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id, tenant_id) REFERENCES assurance_orders(order_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT assurance_timeline_case_fk FOREIGN KEY (case_id, order_id, tenant_id)
    REFERENCES assurance_cases(case_id, order_id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS assurance_case_timeline_order_idx
  ON assurance_case_timeline_events (tenant_id, order_id, occurred_at, timeline_event_id);
CREATE INDEX IF NOT EXISTS assurance_case_timeline_case_idx
  ON assurance_case_timeline_events (tenant_id, case_id, occurred_at, timeline_event_id);

CREATE TABLE IF NOT EXISTS assurance_action_items (
  action_id TEXT PRIMARY KEY CHECK (action_id ~ '^assurance_action_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  case_id TEXT NULL,
  worker_account_id TEXT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  due_at TIMESTAMPTZ NULL,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('worker','company','reviewer','assessor','admin','payment','background_job')),
  internal_owner_membership_id TEXT NULL CHECK (internal_owner_membership_id IS NULL OR char_length(internal_owner_membership_id) BETWEEN 8 AND 96),
  allowed_action TEXT NOT NULL CHECK (char_length(allowed_action) BETWEEN 3 AND 120),
  deep_link TEXT NOT NULL CHECK (deep_link ~ '^/company/assurance-orders/assurance_order_[A-Za-z0-9_-]{24}(?:[#?][A-Za-z0-9_./:@?=&%-]+)?$'),
  statutory BOOLEAN NOT NULL DEFAULT FALSE,
  action_status TEXT NOT NULL DEFAULT 'open' CHECK (action_status IN ('open','acknowledged','snoozed','resolved')),
  acknowledged_at TIMESTAMPTZ NULL,
  snoozed_until TIMESTAMPTZ NULL,
  snooze_reason TEXT NULL CHECK (snooze_reason IS NULL OR char_length(snooze_reason) BETWEEN 3 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id, tenant_id) REFERENCES assurance_orders(order_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT assurance_action_case_fk FOREIGN KEY (case_id, order_id, tenant_id)
    REFERENCES assurance_cases(case_id, order_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT assurance_action_state_check CHECK (
    (action_status='open' AND acknowledged_at IS NULL AND snoozed_until IS NULL AND snooze_reason IS NULL)
    OR (action_status='acknowledged' AND acknowledged_at IS NOT NULL AND snoozed_until IS NULL AND snooze_reason IS NULL)
    OR (action_status='snoozed' AND snoozed_until IS NOT NULL AND snooze_reason IS NOT NULL)
    OR (action_status='resolved')
  )
);
CREATE INDEX IF NOT EXISTS assurance_action_items_queue_idx
  ON assurance_action_items (tenant_id, action_status, severity, due_at, created_at);

CREATE OR REPLACE FUNCTION hse_assurance_order_scope_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Once submitted, Assurance Order scope is immutable and cannot be modified.
  IF OLD.order_status IN ('SUBMITTED','PARTIALLY_FUNDED','ACTIVE','COMPLETED','CANCELLED','CLOSED') AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
    NEW.created_by_membership_id IS DISTINCT FROM OLD.created_by_membership_id OR
    NEW.order_name IS DISTINCT FROM OLD.order_name OR
    NEW.order_reference IS DISTINCT FROM OLD.order_reference OR
    NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.department_id IS DISTINCT FROM OLD.department_id OR
    NEW.requested_identity_checks IS DISTINCT FROM OLD.requested_identity_checks OR
    NEW.requested_evidence_checks IS DISTINCT FROM OLD.requested_evidence_checks OR
    NEW.assessment_framework_references IS DISTINCT FROM OLD.assessment_framework_references OR
    NEW.interview_required IS DISTINCT FROM OLD.interview_required OR
    NEW.credential_target IS DISTINCT FROM OLD.credential_target OR NEW.deadline IS DISTINCT FROM OLD.deadline OR
    NEW.effective_policy_reference IS DISTINCT FROM OLD.effective_policy_reference OR
    NEW.company_notes IS DISTINCT FROM OLD.company_notes OR
    NEW.purchase_order_reference IS DISTINCT FROM OLD.purchase_order_reference OR
    NEW.scope_version IS DISTINCT FROM OLD.scope_version
  ) THEN
    RAISE EXCEPTION 'Submitted Assurance Order scope is immutable and cannot be modified.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS assurance_order_scope_guard ON assurance_orders;
CREATE TRIGGER assurance_order_scope_guard BEFORE UPDATE ON assurance_orders
FOR EACH ROW EXECUTE FUNCTION hse_assurance_order_scope_guard();

CREATE OR REPLACE FUNCTION hse_assurance_target_scope_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_status TEXT;
BEGIN
  SELECT order_status INTO parent_status FROM assurance_orders WHERE order_id=OLD.order_id;
  IF parent_status IN ('SUBMITTED','PARTIALLY_FUNDED','ACTIVE','COMPLETED','CANCELLED','CLOSED') THEN
    RAISE EXCEPTION 'Submitted Assurance Order worker scope cannot be modified.' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS assurance_target_scope_guard ON assurance_order_workers;
CREATE TRIGGER assurance_target_scope_guard BEFORE UPDATE OR DELETE ON assurance_order_workers
FOR EACH ROW EXECUTE FUNCTION hse_assurance_target_scope_guard();

CREATE OR REPLACE FUNCTION hse_assurance_timeline_append_only_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Assurance case timeline is append-only and cannot be updated.' USING ERRCODE='55000';
  END IF;
  RAISE EXCEPTION 'Assurance case timeline is append-only and cannot be deleted.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS assurance_case_timeline_append_only_guard ON assurance_case_timeline_events;
CREATE TRIGGER assurance_case_timeline_append_only_guard
BEFORE UPDATE OR DELETE ON assurance_case_timeline_events
FOR EACH ROW EXECUTE FUNCTION hse_assurance_timeline_append_only_guard();
