DROP TRIGGER IF EXISTS company_verification_evidence_history_guard
  ON company_verification_evidence;
DROP FUNCTION IF EXISTS hse_guard_company_verification_evidence_history();

DROP TRIGGER IF EXISTS company_verification_version_history_guard
  ON company_verification_versions;
DROP FUNCTION IF EXISTS hse_guard_company_verification_version_history();

DROP TABLE IF EXISTS company_verification_duplicate_signals;
DROP TABLE IF EXISTS company_verification_evidence;

ALTER TABLE IF EXISTS company_verification_cases
  DROP CONSTRAINT IF EXISTS company_verification_current_version_fk;

DROP TABLE IF EXISTS company_verification_versions;
DROP TABLE IF EXISTS company_verification_cases;
DROP TABLE IF EXISTS company_registration_flows;

ALTER TABLE auth_rate_limit_buckets
  DROP CONSTRAINT IF EXISTS auth_rate_limit_buckets_action_check;

ALTER TABLE auth_rate_limit_buckets
  ADD CONSTRAINT auth_rate_limit_buckets_action_check
  CHECK (action IN ('worker_registration_start'));
