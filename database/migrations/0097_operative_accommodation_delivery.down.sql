-- Started accessible delivery and assigned human support remain immutable history.
LOCK TABLE interview_accommodation_support_messages, interview_accommodation_support_snapshots, assessment_accommodation_breaks, assessment_attempt_accommodations IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM interview_accommodation_support_messages)
    OR EXISTS (SELECT 1 FROM interview_accommodation_support_snapshots)
    OR EXISTS (SELECT 1 FROM assessment_accommodation_breaks)
    OR EXISTS (SELECT 1 FROM assessment_attempt_accommodations) THEN
  RAISE EXCEPTION 'Operative accommodation delivery and support history must be retained; rollback refused.' USING ERRCODE='55000';
 END IF;
END;
$$;
DROP TABLE IF EXISTS interview_accommodation_support_messages;
DROP TABLE IF EXISTS interview_accommodation_support_snapshots;
DROP FUNCTION IF EXISTS reject_interview_support_mutation();
DROP TABLE IF EXISTS assessment_accommodation_breaks;
DROP TABLE IF EXISTS assessment_attempt_accommodations;
