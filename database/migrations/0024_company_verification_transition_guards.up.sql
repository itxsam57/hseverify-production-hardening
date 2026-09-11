CREATE OR REPLACE FUNCTION hse_guard_company_verification_case_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Company verification case history is durable.' USING ERRCODE = '23514';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.owner_account_id IS DISTINCT FROM OLD.owner_account_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Company verification case authority is immutable.' USING ERRCODE = '23514';
  END IF;

  IF OLD.case_status = 'draft' AND NEW.case_status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'Invalid Company verification case transition.' USING ERRCODE = '23514';
  ELSIF OLD.case_status = 'submitted' AND NEW.case_status NOT IN ('submitted', 'under_review', 'withdrawn') THEN
    RAISE EXCEPTION 'Invalid Company verification case transition.' USING ERRCODE = '23514';
  ELSIF OLD.case_status = 'under_review' AND NEW.case_status NOT IN ('under_review', 'changes_requested', 'verified', 'rejected') THEN
    RAISE EXCEPTION 'Invalid Company verification case transition.' USING ERRCODE = '23514';
  ELSIF OLD.case_status = 'changes_requested' AND NEW.case_status NOT IN ('changes_requested', 'draft') THEN
    RAISE EXCEPTION 'Invalid Company verification case transition.' USING ERRCODE = '23514';
  ELSIF OLD.case_status IN ('verified', 'rejected', 'withdrawn') AND NEW.case_status <> OLD.case_status THEN
    RAISE EXCEPTION 'Terminal Company verification case state is immutable.' USING ERRCODE = '23514';
  END IF;

  IF OLD.case_status = 'verified' AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'Verified Company timestamp is immutable.' USING ERRCODE = '23514';
  END IF;
  IF OLD.case_status = 'rejected' AND NEW.rejected_at IS DISTINCT FROM OLD.rejected_at THEN
    RAISE EXCEPTION 'Rejected Company timestamp is immutable.' USING ERRCODE = '23514';
  END IF;
  IF OLD.case_status = 'withdrawn' AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
    RAISE EXCEPTION 'Withdrawn Company timestamp is immutable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_verification_case_lifecycle_guard
  ON company_verification_cases;
CREATE TRIGGER company_verification_case_lifecycle_guard
BEFORE UPDATE OR DELETE ON company_verification_cases
FOR EACH ROW
EXECUTE FUNCTION hse_guard_company_verification_case_lifecycle();

CREATE OR REPLACE FUNCTION hse_guard_company_verification_version_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Company verification version history is immutable.' USING ERRCODE = '23514';
  END IF;

  IF OLD.version_status = 'draft' AND NEW.version_status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'Invalid Company verification version transition.' USING ERRCODE = '23514';
  ELSIF OLD.version_status = 'submitted' AND NEW.version_status NOT IN ('submitted', 'changes_requested', 'verified', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'Invalid Company verification version transition.' USING ERRCODE = '23514';
  ELSIF OLD.version_status IN ('changes_requested', 'verified', 'rejected', 'withdrawn')
        AND NEW.version_status <> OLD.version_status THEN
    RAISE EXCEPTION 'Terminal Company verification version state is immutable.' USING ERRCODE = '23514';
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

  IF OLD.version_status IN ('changes_requested', 'verified', 'rejected', 'withdrawn')
     AND NEW.terminal_at IS DISTINCT FROM OLD.terminal_at THEN
    RAISE EXCEPTION 'Terminal Company verification timestamp is immutable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
