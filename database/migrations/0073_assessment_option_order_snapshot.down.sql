DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM generated_assessment_form_items items
      JOIN assessment_question_versions versions
        ON versions.question_id=items.question_id
       AND versions.question_version_id=items.question_version_id
     WHERE items.option_order_json IS NOT NULL
       AND items.option_order_json IS DISTINCT FROM versions.options_json
  ) THEN
    RAISE EXCEPTION 'Cannot remove persisted randomized option order from generated assessment history.';
  END IF;
END $$;

ALTER TABLE generated_assessment_form_items
  DROP CONSTRAINT IF EXISTS generated_assessment_form_items_option_order_check;
ALTER TABLE generated_assessment_form_items
  DROP COLUMN IF EXISTS option_order_json;
