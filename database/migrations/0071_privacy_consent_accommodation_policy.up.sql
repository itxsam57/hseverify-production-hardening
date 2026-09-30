-- Masterplan M3.09 completion: versioned consent and accommodation policy overlays.

ALTER TABLE privacy_requests
  DROP CONSTRAINT IF EXISTS privacy_requests_request_type_check;
ALTER TABLE privacy_requests
  ADD CONSTRAINT privacy_requests_request_type_check CHECK (
    request_type IN (
      'access','correction','restriction','consent_withdrawal',
      'share_link_revocation','retention_inquiry','deletion','export'
    )
  );

CREATE TABLE IF NOT EXISTS privacy_consent_records (
  consent_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  worker_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  consent_type TEXT NOT NULL CHECK (consent_type IN (
    'webcam','microphone','screen_recording','interview_recording',
    'company_data_sharing','public_profile_fields','scoped_share_links','retention_notice'
  )),
  purpose TEXT NOT NULL CHECK (char_length(trim(purpose)) BETWEEN 5 AND 1000),
  case_id TEXT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
  actor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('GRANTED','WITHDRAWN')),
  withdrawal_rule TEXT NOT NULL CHECK (withdrawal_rule IN (
    'FUTURE_PROCESSING_ONLY','NOT_WITHDRAWABLE_WHILE_REQUIRED'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (consent_id,version)
);
CREATE INDEX IF NOT EXISTS privacy_consent_worker_idx
  ON privacy_consent_records(worker_id,recorded_at DESC);
CREATE INDEX IF NOT EXISTS privacy_consent_case_idx
  ON privacy_consent_records(case_id,recorded_at DESC) WHERE case_id IS NOT NULL;

CREATE OR REPLACE FUNCTION hse_privacy_consent_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Consent history is append-only.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS privacy_consent_records_append_only ON privacy_consent_records;
CREATE TRIGGER privacy_consent_records_append_only
BEFORE UPDATE OR DELETE ON privacy_consent_records
FOR EACH ROW EXECUTE FUNCTION hse_privacy_consent_append_only();

ALTER TABLE accessibility_accommodations
  ADD COLUMN IF NOT EXISTS case_id TEXT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS approved_adjustment JSONB NULL;

ALTER TABLE accessibility_accommodations
  DROP CONSTRAINT IF EXISTS accessibility_accommodations_review_state_check;
ALTER TABLE accessibility_accommodations
  ADD CONSTRAINT accessibility_accommodations_review_state_check CHECK (
    (status='REQUESTED'
      AND reviewed_by_account_id IS NULL AND reviewed_at IS NULL
      AND review_reason IS NULL AND approved_adjustment IS NULL)
    OR
    (status='DECLINED'
      AND reviewed_by_account_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND review_reason IS NOT NULL AND approved_adjustment IS NULL)
    OR
    (status='APPROVED'
      AND case_id IS NOT NULL
      AND reviewed_by_account_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND review_reason IS NOT NULL AND approved_adjustment IS NOT NULL
      AND jsonb_typeof(approved_adjustment)='object')
  );

CREATE INDEX IF NOT EXISTS accessibility_accommodation_review_idx
  ON accessibility_accommodations(status,created_at,accommodation_id);

CREATE TABLE IF NOT EXISTS assurance_case_accommodation_overlays (
  overlay_id TEXT PRIMARY KEY,
  accommodation_id TEXT NOT NULL UNIQUE REFERENCES accessibility_accommodations(accommodation_id) ON DELETE RESTRICT,
  case_id TEXT NOT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
  worker_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  adjustment JSONB NOT NULL CHECK (jsonb_typeof(adjustment)='object'),
  approved_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS assurance_case_accommodation_case_idx
  ON assurance_case_accommodation_overlays(case_id,approved_at,overlay_id);

CREATE OR REPLACE FUNCTION hse_accommodation_overlay_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Accommodation policy overlays are append-only.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS assurance_case_accommodation_overlays_append_only
  ON assurance_case_accommodation_overlays;
CREATE TRIGGER assurance_case_accommodation_overlays_append_only
BEFORE UPDATE OR DELETE ON assurance_case_accommodation_overlays
FOR EACH ROW EXECUTE FUNCTION hse_accommodation_overlay_append_only();
