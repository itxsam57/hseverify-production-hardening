-- Refuse rollback that would erase retained explicit trade verification provenance.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM assurance_policy_versions WHERE policy_values #> '{assessmentEligibility,verifiedTrades}' IS NOT NULL)
  OR EXISTS(SELECT 1 FROM tenant_policy_overrides WHERE override_values #> '{assessmentEligibility,verifiedTrades}' IS NOT NULL)
  OR EXISTS(SELECT 1 FROM assurance_case_policy_snapshots WHERE effective_value_json #> '{assessmentEligibility,verifiedTrades}' IS NOT NULL) THEN
  RAISE EXCEPTION 'Retained configured trade policy history prevents rollback' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT 1 FROM evidence_review_decisions WHERE verified_trade IS NOT NULL) THEN
  RAISE EXCEPTION 'Retained explicit trade verification history prevents rollback' USING ERRCODE='55000';
 END IF;
END; $$;
DROP TRIGGER evidence_review_explicit_trade_guard ON evidence_review_decisions;
DROP FUNCTION hse_explicit_verified_trade_guard();
ALTER TABLE evidence_review_decisions DROP CONSTRAINT evidence_review_verified_trade_shape,
 DROP COLUMN verification_source_file_id, DROP COLUMN verification_method, DROP COLUMN verified_trade;
