CREATE TABLE IF NOT EXISTS report_deliveries (
  report_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  delivery_key TEXT NOT NULL UNIQUE,
  schedule_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ,PRIMARY KEY (report_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS report_deliveries_tenant_idx ON report_deliveries(tenant_id);
