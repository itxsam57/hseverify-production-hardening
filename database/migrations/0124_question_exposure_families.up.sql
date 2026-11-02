-- M2.05.03: stable equivalent variants share an immutable Exposure Family.
-- Existing questions retain independent families; do not infer semantic similarity.
ALTER TABLE assessment_questions ADD COLUMN exposure_family_reference TEXT;
UPDATE assessment_questions SET exposure_family_reference=upper(question_reference);
ALTER TABLE assessment_questions ALTER COLUMN exposure_family_reference SET NOT NULL;
ALTER TABLE assessment_questions ADD CONSTRAINT assessment_questions_exposure_family_format
  CHECK (char_length(exposure_family_reference) BETWEEN 2 AND 120
    AND exposure_family_reference ~ '^[A-Z0-9][A-Z0-9._:/-]*$');

CREATE FUNCTION hse_question_exposure_family_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.exposure_family_reference := COALESCE(NEW.exposure_family_reference, upper(NEW.question_reference));
  ELSIF NEW.exposure_family_reference IS DISTINCT FROM OLD.exposure_family_reference THEN
    RAISE EXCEPTION 'Question Exposure Family cannot be changed after creation.'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER question_exposure_family_immutable
  BEFORE INSERT OR UPDATE ON assessment_questions FOR EACH ROW
  EXECUTE FUNCTION hse_question_exposure_family_immutable();

ALTER TABLE generated_assessment_form_items ADD COLUMN exposure_family_reference TEXT;
UPDATE generated_assessment_form_items AS i SET exposure_family_reference=q.exposure_family_reference
  FROM assessment_questions q WHERE q.question_id=i.question_id;
ALTER TABLE generated_assessment_form_items ALTER COLUMN exposure_family_reference SET NOT NULL;

CREATE FUNCTION hse_question_exposure_family_reservation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT exposure_family_reference INTO NEW.exposure_family_reference
  FROM assessment_questions WHERE question_id=NEW.question_id;
  IF NEW.exposure_family_reference IS NULL THEN
    RAISE EXCEPTION 'Question Exposure Family is unavailable.' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER generated_assessment_form_items_exposure_family
  BEFORE INSERT ON generated_assessment_form_items FOR EACH ROW
  EXECUTE FUNCTION hse_question_exposure_family_reservation();

-- Cross-case and intra-form identical-family races fail atomically at the DB boundary,
-- even if independent requests select different question_id values.
CREATE UNIQUE INDEX generated_assessment_form_items_worker_family_uq
  ON generated_assessment_form_items(worker_account_id,exposure_family_reference);
CREATE INDEX assessment_questions_exposure_family_idx
  ON assessment_questions(exposure_family_reference,question_id);
