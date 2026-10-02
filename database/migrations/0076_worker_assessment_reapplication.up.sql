ALTER TABLE worker_assessment_applications DROP CONSTRAINT worker_assessment_applications_application_status_check;
ALTER TABLE worker_assessment_applications ADD CONSTRAINT worker_assessment_applications_application_status_check
 CHECK (application_status IN ('PAYMENT_REQUIRED','FUNDING_REQUESTED','FUNDED','CASE_CREATED','COMPLETED','REJECTED','CANCELLED'));
ALTER TABLE worker_assessment_applications DROP CONSTRAINT worker_assessment_app_funded_check;
ALTER TABLE worker_assessment_applications ADD CONSTRAINT worker_assessment_app_funded_check CHECK (
 (application_status IN ('PAYMENT_REQUIRED','FUNDING_REQUESTED','REJECTED','CANCELLED') AND funded_at IS NULL)
 OR (application_status IN ('FUNDED','CASE_CREATED','COMPLETED') AND funded_at IS NOT NULL));
ALTER TABLE worker_assessment_applications DROP CONSTRAINT worker_assessment_app_case_check;
ALTER TABLE worker_assessment_applications ADD CONSTRAINT worker_assessment_app_case_check CHECK (
 (application_status IN ('CASE_CREATED','COMPLETED') AND assurance_order_id IS NOT NULL AND assurance_case_id IS NOT NULL AND completed_at IS NOT NULL)
 OR (application_status NOT IN ('CASE_CREATED','COMPLETED') AND assurance_order_id IS NULL AND assurance_case_id IS NULL AND completed_at IS NULL));
