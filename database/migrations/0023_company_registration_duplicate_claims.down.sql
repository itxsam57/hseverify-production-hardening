DROP INDEX IF EXISTS company_verification_legal_name_fingerprint_idx;
DROP INDEX IF EXISTS company_verification_registration_claim_idx;

ALTER TABLE company_verification_cases
  DROP CONSTRAINT IF EXISTS company_verification_legal_name_fingerprint_check,
  DROP CONSTRAINT IF EXISTS company_verification_registration_fingerprint_check,
  DROP COLUMN IF EXISTS legal_name_fingerprint,
  DROP COLUMN IF EXISTS registration_fingerprint;

ALTER TABLE company_registration_flows
  DROP CONSTRAINT IF EXISTS company_registration_flow_case_fk;
