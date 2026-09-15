CREATE TABLE IF NOT EXISTS scoped_share_links (
  share_link_id text PRIMARY KEY,
  owner_worker_id text NOT NULL,
  fields jsonb NOT NULL,
  purpose text NOT NULL,
  employer_detail text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  token_nonce_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS scoped_share_access_logs (
  share_link_id text NOT NULL REFERENCES scoped_share_links(share_link_id),
  accessed_at timestamptz NOT NULL,
  outcome text NOT NULL,
  reason text NOT NULL
);

CREATE INDEX IF NOT EXISTS scoped_share_links_owner_idx ON scoped_share_links(owner_worker_id);
