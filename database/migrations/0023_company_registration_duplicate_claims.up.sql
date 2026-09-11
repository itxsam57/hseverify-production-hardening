ALTER TABLE company_registration_flows
  ADD CONSTRAINT company_registration_flow_case_fk
  FOREIGN KEY (case_id)
  REFERENCES company_verification_cases(case_id)
  ON DELETE RESTRICT;

ALTER TABLE company_verification_cases
  ADD COLUMN registration_fingerprint TEXT NULL,
  ADD COLUMN legal_name_fingerprint TEXT NULL;

ALTER TABLE company_verification_cases
  ADD CONSTRAINT company_verification_registration_fingerprint_check
  CHECK (registration_fingerprint IS NULL OR registration_fingerprint ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT company_verification_legal_name_fingerprint_check
  CHECK (legal_name_fingerprint IS NULL OR legal_name_fingerprint ~ '^[a-f0-9]{64}$');

CREATE UNIQUE INDEX company_verification_registration_claim_idx
  ON company_verification_cases (registration_fingerprint)
  WHERE registration_fingerprint IS NOT NULL
    AND case_status <> 'withdrawn';

CREATE INDEX company_verification_legal_name_fingerprint_idx
  ON company_verification_cases (legal_name_fingerprint)
  WHERE legal_name_fingerprint IS NOT NULL;
