DROP TRIGGER IF EXISTS company_verification_case_lifecycle_guard
  ON company_verification_cases;
DROP FUNCTION IF EXISTS hse_guard_company_verification_case_lifecycle();

CREATE OR REPLACE FUNCTION hse_guard_company_verification_version_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Company verification version history is immutable.' USING ERRCODE = '23514';
  END IF;

  IF OLD.version_status <> 'draft' AND (
    NEW.case_id IS DISTINCT FROM OLD.case_id OR
    NEW.version_number IS DISTINCT FROM OLD.version_number OR
    NEW.parent_version_id IS DISTINCT FROM OLD.parent_version_id OR
    NEW.draft_revision IS DISTINCT FROM OLD.draft_revision OR
    NEW.legal_name IS DISTINCT FROM OLD.legal_name OR
    NEW.trading_name IS DISTINCT FROM OLD.trading_name OR
    NEW.registration_number IS DISTINCT FROM OLD.registration_number OR
    NEW.country IS DISTINCT FROM OLD.country OR
    NEW.industry IS DISTINCT FROM OLD.industry OR
    NEW.company_size IS DISTINCT FROM OLD.company_size OR
    NEW.website IS DISTINCT FROM OLD.website OR
    NEW.authorized_representative IS DISTINCT FROM OLD.authorized_representative OR
    NEW.business_email_normalized IS DISTINCT FROM OLD.business_email_normalized OR
    NEW.business_phone_e164 IS DISTINCT FROM OLD.business_phone_e164 OR
    NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at OR
    NEW.privacy_accepted_at IS DISTINCT FROM OLD.privacy_accepted_at OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  ) THEN
    RAISE EXCEPTION 'Submitted Company verification details are immutable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
