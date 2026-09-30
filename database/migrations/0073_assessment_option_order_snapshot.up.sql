-- Persist the exact MCQ option order generated for each assessment form item.

ALTER TABLE generated_assessment_form_items
  ADD COLUMN IF NOT EXISTS option_order_json JSONB NULL;

ALTER TABLE generated_assessment_form_items
  DROP CONSTRAINT IF EXISTS generated_assessment_form_items_option_order_check;
ALTER TABLE generated_assessment_form_items
  ADD CONSTRAINT generated_assessment_form_items_option_order_check CHECK (
    option_order_json IS NULL OR (
      jsonb_typeof(option_order_json)='array'
      AND jsonb_array_length(option_order_json) BETWEEN 2 AND 12
    )
  );

-- Historical forms were delivered in authored option order. Snapshot that exact order
-- before new forms begin receiving randomized persisted order.
DROP TRIGGER IF EXISTS generated_assessment_form_items_append_only
  ON generated_assessment_form_items;

UPDATE generated_assessment_form_items items
   SET option_order_json=versions.options_json
  FROM assessment_question_versions versions
 WHERE versions.question_id=items.question_id
   AND versions.question_version_id=items.question_version_id
   AND versions.question_type='MULTIPLE_CHOICE'
   AND items.option_order_json IS NULL;

CREATE TRIGGER generated_assessment_form_items_append_only
BEFORE UPDATE OR DELETE ON generated_assessment_form_items
FOR EACH ROW EXECUTE FUNCTION hse_generated_assessment_form_append_only();
