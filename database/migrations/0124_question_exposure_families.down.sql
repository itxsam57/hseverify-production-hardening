-- Never silently forget permanent Worker-family exposure or break immutable history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM generated_assessment_form_items LIMIT 1)
     OR EXISTS (SELECT 1 FROM assessment_questions LIMIT 1) THEN
    RAISE EXCEPTION 'Question Exposure Family bindings and reservations must be retained.'
      USING ERRCODE='55000';
  END IF;
END; $$;
DROP INDEX generated_assessment_form_items_worker_family_uq;
DROP TRIGGER generated_assessment_form_items_exposure_family ON generated_assessment_form_items;
DROP FUNCTION hse_question_exposure_family_reservation();
ALTER TABLE generated_assessment_form_items DROP COLUMN exposure_family_reference;
DROP INDEX assessment_questions_exposure_family_idx;
DROP TRIGGER question_exposure_family_immutable ON assessment_questions;
DROP FUNCTION hse_question_exposure_family_immutable();
ALTER TABLE assessment_questions DROP CONSTRAINT assessment_questions_exposure_family_format;
ALTER TABLE assessment_questions DROP COLUMN exposure_family_reference;
