-- Preserve application history; downgrade requires resolving any duplicate open catalogue applications first.
UPDATE worker_assessment_applications SET application_status='CASE_CREATED' WHERE application_status='COMPLETED';
ALTER TABLE worker_assessment_applications DROP CONSTRAINT worker_assessment_applications_application_status_check;
ALTER TABLE worker_assessment_applications ADD CONSTRAINT worker_assessment_applications_application_status_check
 CHECK (application_status IN ('PAYMENT_REQUIRED','FUNDING_REQUESTED','FUNDED','CASE_CREATED','REJECTED','CANCELLED'));
