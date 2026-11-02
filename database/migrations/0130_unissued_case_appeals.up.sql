-- Formal appeal of a rejected, unissued Assurance Case. Separate from issued-credential appeals.
CREATE TABLE assurance_case_appeals (
 appeal_id TEXT PRIMARY KEY CHECK (appeal_id ~ '^case_appeal_[A-Za-z0-9_-]{24}$'),
 case_id TEXT NOT NULL REFERENCES assurance_cases(case_id),
 tenant_id TEXT NOT NULL,
 worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id),
 decision_id TEXT NOT NULL REFERENCES platform_decisions(decision_id),
 grounds TEXT NOT NULL CHECK (length(grounds) BETWEEN 10 AND 4000),
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','under_review','accepted','rejected','withdrawn')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 reviewer_account_id TEXT REFERENCES auth_accounts(account_id),
 review_reason TEXT CHECK(review_reason IS NULL OR length(review_reason) BETWEEN 10 AND 4000),
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT case_appeal_review_fields CHECK(
  (status IN ('submitted','withdrawn') AND reviewer_account_id IS NULL AND reviewed_at IS NULL)
  OR (status IN ('under_review','accepted','rejected') AND reviewer_account_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL)
 )
);
CREATE UNIQUE INDEX one_open_case_appeal ON assurance_case_appeals(case_id) WHERE status IN ('submitted','under_review');
CREATE INDEX case_appeals_worker_idx ON assurance_case_appeals(worker_account_id,created_at DESC);
CREATE INDEX case_appeals_status_idx ON assurance_case_appeals(status,created_at);
CREATE TABLE assurance_case_appeal_events (
 appeal_id TEXT NOT NULL REFERENCES assurance_case_appeals(appeal_id),
 version INTEGER NOT NULL CHECK(version>0),
 status TEXT NOT NULL CHECK(status IN ('submitted','under_review','accepted','rejected','withdrawn')),
 actor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 4000),
 occurred_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(appeal_id,version)
);
CREATE FUNCTION retain_case_appeal_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Case appeal events are immutable' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER case_appeal_event_immutable BEFORE UPDATE OR DELETE ON assurance_case_appeal_events
 FOR EACH ROW EXECUTE FUNCTION retain_case_appeal_events();
CREATE FUNCTION guard_case_appeal_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
 SELECT 1 FROM assurance_cases cases JOIN platform_decisions decision
   ON decision.decision_id=NEW.decision_id AND decision.case_id=cases.case_id AND decision.tenant_id=cases.tenant_id
 WHERE cases.case_id=NEW.case_id AND cases.tenant_id=NEW.tenant_id
  AND cases.worker_account_id=NEW.worker_account_id AND cases.case_status='Rejected'
  AND cases.credential_reference IS NULL AND cases.decision_reference=NEW.decision_id
  AND decision.state='REJECTED'
 ) THEN RAISE EXCEPTION 'Rejected case appeal provenance is invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER case_appeal_source_guard BEFORE INSERT ON assurance_case_appeals
 FOR EACH ROW EXECUTE FUNCTION guard_case_appeal_source();
CREATE FUNCTION guard_case_appeal_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.appeal_id<>OLD.appeal_id OR NEW.case_id<>OLD.case_id OR NEW.tenant_id<>OLD.tenant_id
  OR NEW.worker_account_id<>OLD.worker_account_id OR NEW.decision_id<>OLD.decision_id
  OR NEW.grounds<>OLD.grounds OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
  OR OLD.status NOT IN ('submitted','under_review') THEN
  RAISE EXCEPTION 'Case appeal source and terminal outcome are immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER case_appeal_update_guard BEFORE UPDATE ON assurance_case_appeals
 FOR EACH ROW EXECUTE FUNCTION guard_case_appeal_update();
