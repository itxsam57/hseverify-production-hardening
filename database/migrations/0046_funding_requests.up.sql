CREATE TABLE IF NOT EXISTS funding_requests (
  funding_request_id TEXT PRIMARY KEY CHECK (char_length(funding_request_id) BETWEEN 16 AND 96),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id),
  worker_link_id TEXT NOT NULL,
  requested_by_account_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')),
  credit_units INTEGER NOT NULL CHECK (credit_units > 0),
  reserved_credit_units INTEGER NOT NULL DEFAULT 0 CHECK (reserved_credit_units >= 0 AND reserved_credit_units <= credit_units),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 3 AND 160),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS funding_requests_tenant_status_idx ON funding_requests(tenant_id,status,created_at DESC);
