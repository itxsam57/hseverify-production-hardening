CREATE TABLE assessment_integrity_dispositions (
 disposition_id text PRIMARY KEY,
 attempt_id text NOT NULL REFERENCES assessment_attempts(attempt_id),
 review_id text NOT NULL REFERENCES written_score_reviews(review_id),
 case_id text NOT NULL REFERENCES assurance_cases(case_id),
 reviewer_account_id text NOT NULL REFERENCES auth_accounts(account_id),
 revision integer NOT NULL CHECK(revision=1),
 disposition text NOT NULL CHECK(disposition IN ('CLEAR','CONCERN_CONFIRMED','UNABLE','ESCALATE')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 4000),
 reviewed_event_count integer NOT NULL CHECK(reviewed_event_count>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(attempt_id,revision)
);
CREATE FUNCTION assessment_integrity_dispositions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Integrity dispositions are immutable'; END; $$;
CREATE TRIGGER assessment_integrity_dispositions_no_mutation BEFORE UPDATE OR DELETE ON assessment_integrity_dispositions
 FOR EACH ROW EXECUTE FUNCTION assessment_integrity_dispositions_immutable();
