CREATE TABLE IF NOT EXISTS living_record_competencies (
  competency_id text PRIMARY KEY,
  worker_id text NOT NULL,
  title text NOT NULL,
  source_credential_id text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS living_record_competencies_worker_lookup
  ON living_record_competencies(worker_id);

CREATE TABLE IF NOT EXISTS living_record_versions (
  competency_id text NOT NULL REFERENCES living_record_competencies(competency_id),
  version integer NOT NULL,
  status text NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  restrictions jsonb NOT NULL,
  conditions jsonb NOT NULL,
  reassessment jsonb NOT NULL,
  PRIMARY KEY (competency_id, version)
);

CREATE INDEX IF NOT EXISTS living_record_versions_current_lookup
  ON living_record_versions(competency_id, version DESC);
