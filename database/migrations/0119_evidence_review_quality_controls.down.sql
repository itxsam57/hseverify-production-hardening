LOCK TABLE reviewer_capacity_revisions,evidence_review_quality_requirements,evidence_review_quality_selections,evidence_review_quality_rounds,scoring_conflict_declarations IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM reviewer_capacity_revisions) OR EXISTS(SELECT 1 FROM evidence_review_quality_requirements)
 OR EXISTS(SELECT 1 FROM evidence_review_quality_selections) OR EXISTS(SELECT 1 FROM evidence_review_quality_rounds)
 OR EXISTS(SELECT 1 FROM scoring_conflict_declarations)
 THEN RAISE EXCEPTION 'Review quality and conflict histories must be retained; rollback refused.' USING ERRCODE='55000'; END IF;
END;$$;
DROP FUNCTION platform_reviewer_capacity_limit(TEXT);
DROP FUNCTION platform_reviewer_open_reviews(TEXT);
DROP TRIGGER scoring_conflict_history_locked ON scoring_conflict_declarations;
DROP TABLE evidence_review_quality_rounds,evidence_review_quality_selections,evidence_review_quality_requirements,reviewer_capacity_revisions,review_quality_defaults;
DROP FUNCTION hse_review_quality_history_locked();

DROP TRIGGER review_capacity_account_insert ON auth_accounts;
DROP FUNCTION hse_review_capacity_account_insert();
DROP TABLE reviewer_capacity_locks;
