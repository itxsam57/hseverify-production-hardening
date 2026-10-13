DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM assessment_integrity_dispositions) THEN
  RAISE EXCEPTION 'Cannot remove retained integrity disposition history';
 END IF;
END $$;
DROP TABLE assessment_integrity_dispositions;
DROP FUNCTION assessment_integrity_dispositions_immutable();
