CREATE TABLE IF NOT EXISTS worker_assessment_applications (
  application_id TEXT PRIMARY KEY CHECK (application_id ~ '^assessment_application_[A-Za-z0-9_-]{24}$'),
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  permanent_worker_id TEXT NOT NULL CHECK (char_length(permanent_worker_id) BETWEEN 8 AND 120),
  catalogue_entry_id TEXT NOT NULL REFERENCES assessment_catalogue_entries(catalogue_entry_id) ON DELETE RESTRICT,
  catalogue_version_id TEXT NOT NULL,
  funding_mode TEXT NOT NULL CHECK (funding_mode IN ('WORKER_PAY','COMPANY_REQUEST')),
  company_tenant_id TEXT NULL REFERENCES platform_tenants(tenant_id) ON DELETE RESTRICT,
  worker_link_id TEXT NULL,
  funding_request_id TEXT NULL REFERENCES funding_requests(funding_request_id) ON DELETE RESTRICT,
  sandbox_payment_reference TEXT NULL UNIQUE,
  application_status TEXT NOT NULL CHECK (
    application_status IN (
      'PAYMENT_REQUIRED','FUNDING_REQUESTED','FUNDED','CASE_CREATED','REJECTED','CANCELLED'
    )
  ),
  assurance_order_id TEXT NULL,
  assurance_case_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  funded_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT worker_assessment_app_catalogue_version_fk
    FOREIGN KEY (catalogue_entry_id, catalogue_version_id)
    REFERENCES assessment_catalogue_versions(catalogue_entry_id, catalogue_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT worker_assessment_app_company_mode_check CHECK (
    (funding_mode='WORKER_PAY' AND company_tenant_id IS NULL AND worker_link_id IS NULL AND funding_request_id IS NULL)
    OR
    (funding_mode='COMPANY_REQUEST' AND company_tenant_id IS NOT NULL AND worker_link_id IS NOT NULL AND funding_request_id IS NOT NULL)
  ),
  CONSTRAINT worker_assessment_app_funded_check CHECK (
    (application_status IN ('PAYMENT_REQUIRED','FUNDING_REQUESTED','REJECTED','CANCELLED') AND funded_at IS NULL)
    OR
    (application_status IN ('FUNDED','CASE_CREATED') AND funded_at IS NOT NULL)
  ),
  CONSTRAINT worker_assessment_app_case_check CHECK (
    (application_status='CASE_CREATED' AND assurance_order_id IS NOT NULL AND assurance_case_id IS NOT NULL AND completed_at IS NOT NULL)
    OR
    (application_status<>'CASE_CREATED' AND assurance_order_id IS NULL AND assurance_case_id IS NULL AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_assessment_applications_one_open_idx
  ON worker_assessment_applications(worker_account_id,catalogue_version_id)
  WHERE application_status IN ('PAYMENT_REQUIRED','FUNDING_REQUESTED','FUNDED','CASE_CREATED');

CREATE INDEX IF NOT EXISTS worker_assessment_applications_worker_idx
  ON worker_assessment_applications(worker_account_id,created_at DESC);

CREATE INDEX IF NOT EXISTS worker_assessment_applications_company_idx
  ON worker_assessment_applications(company_tenant_id,application_status,created_at DESC)
  WHERE company_tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS worker_assessment_application_events (
  event_id TEXT PRIMARY KEY CHECK (event_id ~ '^assessment_application_event_[A-Za-z0-9_-]{24}$'),
  application_id TEXT NOT NULL REFERENCES worker_assessment_applications(application_id) ON DELETE RESTRICT,
  from_status TEXT NULL,
  to_status TEXT NOT NULL,
  actor_account_id TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('worker','company','admin','root')),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail_json)='object'),
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS worker_assessment_application_events_idx
  ON worker_assessment_application_events(application_id,occurred_at,event_id);

CREATE OR REPLACE FUNCTION hse_worker_assessment_application_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Worker assessment application events are append-only.' USING ERRCODE='55000';
END;
$$;

DROP TRIGGER IF EXISTS worker_assessment_application_events_append_only
  ON worker_assessment_application_events;
CREATE TRIGGER worker_assessment_application_events_append_only
BEFORE UPDATE OR DELETE ON worker_assessment_application_events
FOR EACH ROW EXECUTE FUNCTION hse_worker_assessment_application_events_append_only();
