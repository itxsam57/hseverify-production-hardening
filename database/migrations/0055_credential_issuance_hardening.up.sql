CREATE TABLE IF NOT EXISTS credential_issuance_events (
  credential_id text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL,
  changed_at timestamptz NOT NULL,
  PRIMARY KEY (credential_id, version)
);

CREATE INDEX IF NOT EXISTS credential_issuance_events_lookup
  ON credential_issuance_events(credential_id, changed_at);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'credential_issuances'
  ) THEN
    INSERT INTO credential_issuance_events (credential_id, version, status, changed_at)
    SELECT credential_id, version, status, issued_at
    FROM credential_issuances
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
