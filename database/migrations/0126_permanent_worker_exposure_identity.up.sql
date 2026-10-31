-- M2.05.03 / Masterplan 15.2: exposure ownership is permanent Worker ID,
-- while the original account remains provenance and fallback for legacy records.
-- This migration never combines two identities or infers aliases from matching PII.
ALTER TABLE generated_assessment_forms ADD COLUMN permanent_worker_id TEXT
  REFERENCES worker_identity_worker_ids(permanent_worker_id) ON DELETE RESTRICT;
ALTER TABLE generated_assessment_form_items ADD COLUMN permanent_worker_id TEXT
  REFERENCES worker_identity_worker_ids(permanent_worker_id) ON DELETE RESTRICT;

-- Historical immutable rows may predate the permanent-id exposure column.
-- Backfill only where an authoritative Worker-ID issuance row already exists.
-- Schema/data migration is one transaction; restore append-only guards before commit.
DROP TRIGGER generated_assessment_forms_append_only ON generated_assessment_forms;
DROP TRIGGER generated_assessment_form_items_append_only ON generated_assessment_form_items;
UPDATE generated_assessment_forms AS f
SET permanent_worker_id=ids.permanent_worker_id
FROM worker_identity_worker_ids AS ids
WHERE f.worker_account_id=ids.worker_account_id;
UPDATE generated_assessment_form_items AS i
SET permanent_worker_id=f.permanent_worker_id
FROM generated_assessment_forms AS f
WHERE i.form_id=f.form_id;
CREATE TRIGGER generated_assessment_forms_append_only
  BEFORE UPDATE OR DELETE ON generated_assessment_forms
  FOR EACH ROW EXECUTE FUNCTION hse_generated_assessment_form_append_only();
CREATE TRIGGER generated_assessment_form_items_append_only
  BEFORE UPDATE OR DELETE ON generated_assessment_form_items
  FOR EACH ROW EXECUTE FUNCTION hse_generated_assessment_form_append_only();

-- The caller never supplies the exposure owner. It is derived from the
-- authoritative, unique worker-account -> permanent-Worker-ID issuance row.
CREATE FUNCTION hse_generated_assessment_form_owner_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT ids.permanent_worker_id INTO NEW.permanent_worker_id
  FROM worker_identity_worker_ids AS ids
  WHERE ids.worker_account_id=NEW.worker_account_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER generated_assessment_forms_owner_id
  BEFORE INSERT ON generated_assessment_forms
  FOR EACH ROW EXECUTE FUNCTION hse_generated_assessment_form_owner_id();

-- The item must use the already committed/persisted parent identity, never an
-- arbitrary client-supplied ID. Existing per-account uniqueness remains.
CREATE FUNCTION hse_generated_assessment_item_owner_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT f.permanent_worker_id INTO NEW.permanent_worker_id
  FROM generated_assessment_forms AS f WHERE f.form_id=NEW.form_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER generated_assessment_form_items_owner_id
  BEFORE INSERT ON generated_assessment_form_items
  FOR EACH ROW EXECUTE FUNCTION hse_generated_assessment_item_owner_id();

-- Distinct permanent Worker IDs never share one exposure namespace. A later,
-- independently authorized account association may not reissue an exposed
-- family for the same immutable Worker ID (the account-level constraint stays).
CREATE UNIQUE INDEX generated_assessment_form_items_worker_id_family_uq
  ON generated_assessment_form_items(permanent_worker_id,exposure_family_reference)
  WHERE permanent_worker_id IS NOT NULL;
CREATE INDEX generated_assessment_forms_worker_id_idx
  ON generated_assessment_forms(permanent_worker_id,generated_at DESC)
  WHERE permanent_worker_id IS NOT NULL;
