LOCK TABLE assessment_integrity_dispositions IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM assessment_integrity_dispositions WHERE revision>1) THEN
  RAISE EXCEPTION 'Cannot remove retained integrity amendment history';
 END IF;
END $$;
ALTER TABLE assessment_integrity_dispositions DROP CONSTRAINT assessment_integrity_dispositions_revision_check;
ALTER TABLE assessment_integrity_dispositions ADD CONSTRAINT assessment_integrity_dispositions_revision_check CHECK(revision=1);
ALTER TABLE assessment_integrity_dispositions DROP CONSTRAINT assessment_integrity_dispositions_disposition_check;
ALTER TABLE assessment_integrity_dispositions ADD CONSTRAINT assessment_integrity_dispositions_disposition_check CHECK(disposition IN ('CLEAR','CONCERN_CONFIRMED','UNABLE','ESCALATE'));
ALTER TABLE assessment_integrity_dispositions DROP COLUMN actor_role;
ALTER TABLE assessment_integrity_dispositions DROP COLUMN actor_account_id;
