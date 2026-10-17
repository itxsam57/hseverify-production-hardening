ALTER TABLE assessment_integrity_dispositions DROP CONSTRAINT assessment_integrity_dispositions_revision_check;
ALTER TABLE assessment_integrity_dispositions ADD CONSTRAINT assessment_integrity_dispositions_revision_check CHECK(revision>=1);
ALTER TABLE assessment_integrity_dispositions DROP CONSTRAINT assessment_integrity_dispositions_disposition_check;
ALTER TABLE assessment_integrity_dispositions ADD CONSTRAINT assessment_integrity_dispositions_disposition_check CHECK(disposition IN ('CLEAR','CONCERN_CONFIRMED','UNABLE','ESCALATE','REVIEW_REQUIRED'));
ALTER TABLE assessment_integrity_dispositions ADD COLUMN actor_account_id text REFERENCES auth_accounts(account_id);
ALTER TABLE assessment_integrity_dispositions ADD COLUMN actor_role text NOT NULL DEFAULT 'verifier' CHECK(actor_role IN ('verifier','admin'));
