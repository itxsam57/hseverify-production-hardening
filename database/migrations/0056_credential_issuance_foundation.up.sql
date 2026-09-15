CREATE TABLE IF NOT EXISTS credential_issuances (
  credential_id text PRIMARY KEY,
  worker_id text NOT NULL,
  qualification text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz,
  status text NOT NULL CHECK (status IN ('valid','expired','suspended','revoked')),
  version integer NOT NULL CHECK (version > 0),
  public_status_url text NOT NULL,
  qr_payload text NOT NULL,
  signature text NOT NULL,
  pdf_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credential_issuances_worker_id_idx ON credential_issuances(worker_id);


CREATE TABLE IF NOT EXISTS credential_lifecycle_events (
  credential_id text NOT NULL REFERENCES credential_issuances(credential_id),
  status text NOT NULL CHECK (status IN ('valid','expired','suspended','revoked')),
  version integer NOT NULL CHECK (version > 0),
  changed_at timestamptz NOT NULL,
  PRIMARY KEY (credential_id, version)
);
