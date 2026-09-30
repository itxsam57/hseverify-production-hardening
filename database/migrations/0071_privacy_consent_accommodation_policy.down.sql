DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM privacy_consent_records LIMIT 1)
     OR EXISTS (SELECT 1 FROM assurance_case_accommodation_overlays LIMIT 1) THEN
    RAISE EXCEPTION 'Cannot roll back consent/accommodation policy history while records exist.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS assurance_case_accommodation_overlays_append_only
  ON assurance_case_accommodation_overlays;
DROP TABLE IF EXISTS assurance_case_accommodation_overlays;
DROP FUNCTION IF EXISTS hse_accommodation_overlay_append_only();

ALTER TABLE accessibility_accommodations
  DROP CONSTRAINT IF EXISTS accessibility_accommodations_review_state_check,
  DROP COLUMN IF EXISTS approved_adjustment,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS reviewed_by_account_id,
  DROP COLUMN IF EXISTS review_reason,
  DROP COLUMN IF EXISTS case_id;

DROP TRIGGER IF EXISTS privacy_consent_records_append_only ON privacy_consent_records;
DROP TABLE IF EXISTS privacy_consent_records;
DROP FUNCTION IF EXISTS hse_privacy_consent_append_only();

ALTER TABLE privacy_requests
  DROP CONSTRAINT IF EXISTS privacy_requests_request_type_check;
ALTER TABLE privacy_requests
  ADD CONSTRAINT privacy_requests_request_type_check CHECK (
    request_type IN ('access','correction','deletion','export')
  );
