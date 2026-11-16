-- M1.09.02: serialize all workforce scope placements with concurrent site or
-- department archive, including code redemption and invitation acceptance.
-- Earlier 0028 trigger only read active status via MVCC, allowing a new Worker
-- link to commit while an archive transaction was paused after its link sweep.
-- The row SHARE lock conflicts with an archive's NO KEY UPDATE lock. Whichever
-- transaction wins, it must see the other operation before committing.
-- Lock the referenced unit itself, not only the link, for insert and update.
CREATE OR REPLACE FUNCTION hse_validate_company_workforce_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_sites AS sites
    WHERE sites.tenant_id = NEW.tenant_id
      AND sites.site_id = NEW.site_id
      AND sites.site_status = 'active'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Company workforce site is unavailable.' USING ERRCODE = '23514';
  END IF;

  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_departments AS departments
    WHERE departments.tenant_id = NEW.tenant_id
      AND departments.department_id = NEW.department_id
      AND departments.department_status = 'active'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Company workforce department is unavailable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- An existing leaked link predating this migration is not silently rewritten:
-- repair requires independently audited Company and Worker evidence first.
-- Do not mark deployment ready when legacy archived-unit placements remain.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM company_worker_links links
    JOIN company_sites sites ON sites.tenant_id=links.tenant_id AND sites.site_id=links.site_id
    WHERE links.link_status IN ('active','pending_worker_acceptance') AND sites.site_status='archived'
  ) OR EXISTS (
    SELECT 1 FROM company_worker_links links
    JOIN company_departments departments ON departments.tenant_id=links.tenant_id AND departments.department_id=links.department_id
    WHERE links.link_status IN ('active','pending_worker_acceptance') AND departments.department_status='archived'
  ) THEN
    RAISE EXCEPTION 'Pre-existing archived Company unit Worker placements require audited reconciliation before migration 0131.' USING ERRCODE='23514';
  END IF;
END;
$$;
