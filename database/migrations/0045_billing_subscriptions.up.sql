-- M3.05 Billing and subscriptions.
-- Financial history is append-only; provider callbacks and request keys are idempotent.

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  subscription_id TEXT PRIMARY KEY CHECK (char_length(subscription_id) BETWEEN 16 AND 96),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 3 AND 160),
  plan_code TEXT NOT NULL CHECK (char_length(plan_code) BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CANCELLED')),
  provider_mode TEXT NOT NULL CHECK (provider_mode IN ('sandbox')),
  provider_subscription_reference TEXT NOT NULL UNIQUE CHECK (char_length(provider_subscription_reference) BETWEEN 8 AND 180),
  created_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT billing_subscriptions_tenant_subscription_unique UNIQUE (tenant_id, subscription_id),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS billing_subscriptions_active_idx ON billing_subscriptions(tenant_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS billing_checkouts (
  checkout_id TEXT PRIMARY KEY CHECK (char_length(checkout_id) BETWEEN 16 AND 96),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 3 AND 160),
  credit_units INTEGER NOT NULL CHECK (credit_units > 0),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider_mode TEXT NOT NULL CHECK (provider_mode IN ('sandbox')),
  provider_checkout_reference TEXT NOT NULL UNIQUE CHECK (char_length(provider_checkout_reference) BETWEEN 8 AND 180),
  status TEXT NOT NULL CHECK (status IN ('REQUIRES_PROVIDER','PAID','FAILED')),
  created_by_membership_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ,
  CONSTRAINT billing_checkouts_tenant_checkout_unique UNIQUE (tenant_id, checkout_id),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS billing_checkouts_tenant_status_idx ON billing_checkouts(tenant_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS billing_invoices (
  invoice_id TEXT PRIMARY KEY CHECK (char_length(invoice_id) BETWEEN 16 AND 96),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id),
  checkout_id TEXT NOT NULL UNIQUE,
  credit_units INTEGER NOT NULL CHECK (credit_units > 0),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL CHECK (status IN ('OPEN','PAID','PARTIALLY_REFUNDED','REFUNDED')),
  refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_minor >= 0 AND refunded_amount_minor <= amount_minor),
  created_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT billing_invoices_tenant_invoice_unique UNIQUE (tenant_id, invoice_id),
  CONSTRAINT billing_invoices_checkout_fk FOREIGN KEY (tenant_id, checkout_id)
    REFERENCES billing_checkouts(tenant_id, checkout_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS billing_invoices_tenant_status_idx ON billing_invoices(tenant_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS billing_refunds (
  refund_id TEXT PRIMARY KEY CHECK (char_length(refund_id) BETWEEN 16 AND 96),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id),
  invoice_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 3 AND 160),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  credit_units INTEGER NOT NULL CHECK (credit_units > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider_mode TEXT NOT NULL CHECK (provider_mode IN ('sandbox')),
  provider_refund_reference TEXT NOT NULL UNIQUE CHECK (char_length(provider_refund_reference) BETWEEN 8 AND 180),
  status TEXT NOT NULL CHECK (status IN ('REQUIRES_PROVIDER','SUCCEEDED','FAILED')),
  created_by_membership_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  succeeded_at TIMESTAMPTZ,
  CONSTRAINT billing_refunds_tenant_refund_unique UNIQUE (tenant_id, refund_id),
  CONSTRAINT billing_refunds_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES billing_invoices(tenant_id, invoice_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS billing_refunds_tenant_invoice_idx ON billing_refunds(tenant_id,invoice_id,created_at DESC);

CREATE TABLE IF NOT EXISTS billing_provider_events (
  provider_event_id TEXT PRIMARY KEY CHECK (char_length(provider_event_id) BETWEEN 8 AND 180),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('payment.captured','refund.succeeded')),
  provider_reference TEXT NOT NULL CHECK (char_length(provider_reference) BETWEEN 8 AND 180),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT billing_provider_events_tenant_event_unique UNIQUE (tenant_id, provider_event_id)
);
CREATE INDEX IF NOT EXISTS billing_provider_events_tenant_idx ON billing_provider_events(tenant_id,received_at DESC);

CREATE TABLE IF NOT EXISTS billing_credit_ledger (
  ledger_entry_id TEXT PRIMARY KEY CHECK (char_length(ledger_entry_id) BETWEEN 16 AND 96),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id),
  invoice_id TEXT NOT NULL,
  refund_id TEXT,
  provider_event_id TEXT NOT NULL UNIQUE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('PURCHASE','REFUND')),
  credit_delta INTEGER NOT NULL CHECK (credit_delta <> 0),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  CHECK ((entry_type='PURCHASE' AND credit_delta > 0 AND refund_id IS NULL) OR (entry_type='REFUND' AND credit_delta < 0 AND refund_id IS NOT NULL)),
  CONSTRAINT billing_credit_ledger_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES billing_invoices(tenant_id, invoice_id) ON DELETE RESTRICT,
  CONSTRAINT billing_credit_ledger_refund_fk FOREIGN KEY (tenant_id, refund_id)
    REFERENCES billing_refunds(tenant_id, refund_id) ON DELETE RESTRICT,
  CONSTRAINT billing_credit_ledger_provider_event_fk FOREIGN KEY (tenant_id, provider_event_id)
    REFERENCES billing_provider_events(tenant_id, provider_event_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS billing_credit_ledger_tenant_idx ON billing_credit_ledger(tenant_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS billing_reconciliation_runs (
  reconciliation_run_id TEXT PRIMARY KEY CHECK (char_length(reconciliation_run_id) BETWEEN 16 AND 96),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id),
  status TEXT NOT NULL CHECK (status IN ('CLEAN','DISCREPANCIES_FOUND')),
  created_by_membership_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT billing_reconciliation_runs_tenant_run_unique UNIQUE (tenant_id, reconciliation_run_id)
);
CREATE INDEX IF NOT EXISTS billing_reconciliation_runs_tenant_idx ON billing_reconciliation_runs(tenant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS billing_reconciliation_items (
  reconciliation_item_id TEXT PRIMARY KEY CHECK (char_length(reconciliation_item_id) BETWEEN 16 AND 96),
  reconciliation_run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id),
  code TEXT NOT NULL CHECK (char_length(code) BETWEEN 3 AND 100),
  reference TEXT NOT NULL CHECK (char_length(reference) BETWEEN 3 AND 180),
  detail TEXT NOT NULL CHECK (char_length(detail) BETWEEN 3 AND 500),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT billing_reconciliation_items_run_fk FOREIGN KEY (tenant_id, reconciliation_run_id)
    REFERENCES billing_reconciliation_runs(tenant_id, reconciliation_run_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION hse_billing_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Billing financial history is append-only.' USING ERRCODE='55000';
END; $$;

DROP TRIGGER IF EXISTS billing_credit_ledger_append_only ON billing_credit_ledger;
CREATE TRIGGER billing_credit_ledger_append_only BEFORE UPDATE OR DELETE ON billing_credit_ledger FOR EACH ROW EXECUTE FUNCTION hse_billing_append_only();
DROP TRIGGER IF EXISTS billing_provider_events_append_only ON billing_provider_events;
CREATE TRIGGER billing_provider_events_append_only BEFORE UPDATE OR DELETE ON billing_provider_events FOR EACH ROW EXECUTE FUNCTION hse_billing_append_only();
DROP TRIGGER IF EXISTS billing_reconciliation_items_append_only ON billing_reconciliation_items;
CREATE TRIGGER billing_reconciliation_items_append_only BEFORE UPDATE OR DELETE ON billing_reconciliation_items FOR EACH ROW EXECUTE FUNCTION hse_billing_append_only();

ALTER TABLE platform_audit_events DROP CONSTRAINT IF EXISTS platform_audit_events_action_key_check;
ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK (
  action_key IN (
    'authentication.registration.started','authentication.otp.issued','authentication.otp.failed','authentication.otp.verified','authentication.password.created','authentication.password_reset.requested','authentication.password_reset.completed','authentication.login.failed','authentication.login.succeeded','authentication.logout','authentication.session.revoked','authentication.account.locked','authentication.account.unlocked','authentication.invitation.created','authentication.invitation.accepted','authentication.mfa.enrolled','authentication.mfa.failed','authentication.mfa.succeeded','authorization.access.denied','outbox.job.enqueued','outbox.job.claimed','outbox.job.lease_reclaimed','outbox.job.succeeded','outbox.job.retry_scheduled','outbox.job.terminal_failed','notification.projected','notification.read','notification.deep_link.denied','email.delivery.queued','email.delivery.attempt.started','email.delivery.delivered','email.delivery.retry_scheduled','email.delivery.terminal_failed','secure_file.quarantined','secure_file.scan.queued','secure_file.scan.available','secure_file.scan.unsafe','secure_file.scan.failed','secure_file.access.authorized','secure_file.access.served','worker_identity.created','worker_identity.status.changed','worker_identity.duplicate.evaluated','worker_identity.duplicate.disposition.recorded','worker_identity.worker_id.issued','company_verification.updated','company_verification.evidence.bound','company_verification.submitted','company_verification.withdrawn','company_verification.status.changed','company_organization.created','company_organization.updated','company_organization.archived','company_organization.restored','company_team.invitation.created','company_team.invitation.revoked','company_team.membership.updated','company_team.membership.suspended','company_team.membership.reactivated','company_team.membership.revoked','company_workforce.invitation.created','company_workforce.invitation.resent','company_workforce.invitation.revoked','company_workforce.invitation.accepted','company_workforce.code.created','company_workforce.code.revoked','company_workforce.code.redeemed','company_workforce.link.requested','company_workforce.link.accepted','company_workforce.link.revoked','worker_evidence.record.created','worker_evidence.draft.saved','worker_evidence.file.attached','worker_evidence.file.replaced','worker_evidence.version.submitted','worker_evidence.revision.started','worker_evidence.employment.ended','worker_evidence.skill.inactivated','worker_evidence.leaving_letter.attached','worker_evidence.leaving_letter.replaced','public_verification.concern.received','assurance_order.created','assurance_order.updated','assurance_order.validated','assurance_order.submitted','assurance_order.cancelled','assurance_case.created','assurance_case.status.changed','assurance_action.created','assurance_action.assigned','assurance_action.acknowledged','assurance_action.snoozed','assessment.question.created','assessment.question.revised','assessment.question.status.changed','assessment.blueprint.created','assessment.blueprint.revised','assessment.blueprint.status.changed','assessment.form.generated','assessment.catalogue.created','assessment.catalogue.revised','assessment.catalogue.status.changed','assessment.attempt.started','assessment.attempt.submitted',
    'billing.checkout.created','billing.refund.requested','billing.reconciliation.completed','billing.subscription.started','billing.subscription.cancelled'
  )
);
