CREATE TABLE privacy_request_reviews (
  review_id TEXT PRIMARY KEY,
  review_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  request_id TEXT NOT NULL REFERENCES privacy_requests(request_id) ON DELETE RESTRICT,
  reviewer_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  from_status TEXT NOT NULL CHECK (from_status IN ('OPEN','PROCESSING')),
  to_status TEXT NOT NULL CHECK (to_status IN ('PROCESSING','COMPLETED','REJECTED')),
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 2000),
  reviewed_at TIMESTAMPTZ NOT NULL,
  CHECK (from_status <> to_status)
);
CREATE INDEX privacy_request_reviews_request_idx ON privacy_request_reviews(request_id,review_sequence);
CREATE TRIGGER privacy_request_reviews_append_only
BEFORE UPDATE OR DELETE ON privacy_request_reviews
FOR EACH ROW EXECUTE FUNCTION hse_privacy_consent_append_only();
