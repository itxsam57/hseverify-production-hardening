-- Explicitly import legacy publication without inventing reviewer approval.
ALTER TABLE assessment_questions ADD COLUMN authoring_version_id TEXT;
UPDATE assessment_questions q SET authoring_version_id=COALESCE(q.current_version_id,(SELECT v.question_version_id FROM assessment_question_versions v WHERE v.question_id=q.question_id ORDER BY version_no DESC LIMIT 1));
ALTER TABLE assessment_questions ADD CONSTRAINT assessment_questions_authoring_version_fk FOREIGN KEY(question_id,authoring_version_id) REFERENCES assessment_question_versions(question_id,question_version_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE question_version_workflow (
 question_version_id TEXT PRIMARY KEY REFERENCES assessment_question_versions(question_version_id),
 question_id TEXT NOT NULL,
 workflow_state TEXT NOT NULL CHECK(workflow_state IN ('DRAFT','UNDER_REVIEW','CHANGES_REQUESTED','APPROVED','PUBLISHED','PAUSED','RETIRED','ARCHIVED')),
 author_account_id TEXT NOT NULL,
 approved_by_account_id TEXT,
 approved_at TIMESTAMPTZ,
 provenance TEXT NOT NULL CHECK(provenance IN ('AUTHORED','LEGACY_IMPORTED')),
 revision_no INTEGER NOT NULL DEFAULT 0 CHECK(revision_no>=0),
 transition_actor_account_id TEXT,
 transition_session_id TEXT,
 transition_reason TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(question_id,question_version_id) REFERENCES assessment_question_versions(question_id,question_version_id),
 CHECK ((approved_by_account_id IS NULL)=(approved_at IS NULL)),
 CHECK (approved_by_account_id IS NULL OR approved_by_account_id<>author_account_id),
 CHECK(provenance='LEGACY_IMPORTED' OR workflow_state NOT IN ('APPROVED','PUBLISHED','PAUSED','RETIRED') OR approved_by_account_id IS NOT NULL)
);
CREATE TABLE question_version_workflow_events (
 event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 question_version_id TEXT NOT NULL REFERENCES question_version_workflow(question_version_id),
 from_state TEXT,
 to_state TEXT NOT NULL,
 revision_no INTEGER NOT NULL,
 actor_account_id TEXT,
 reason TEXT,
 provenance TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(question_version_id,revision_no)
);
INSERT INTO question_version_workflow(question_version_id,question_id,workflow_state,author_account_id,provenance)
 SELECT v.question_version_id,v.question_id,CASE WHEN q.current_version_id=v.question_version_id THEN CASE WHEN q.question_status='ACTIVE' THEN 'PUBLISHED' ELSE 'PAUSED' END ELSE 'ARCHIVED' END,v.created_by_account_id,'LEGACY_IMPORTED'
 FROM assessment_question_versions v JOIN assessment_questions q ON q.question_id=v.question_id;
INSERT INTO question_version_workflow_events(question_version_id,to_state,revision_no,provenance)
 SELECT question_version_id,workflow_state,0,provenance FROM question_version_workflow;

CREATE FUNCTION hse_question_workflow_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE version_author TEXT;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Question workflow history is retained.' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT created_by_account_id INTO version_author FROM assessment_question_versions WHERE question_version_id=NEW.question_version_id AND question_id=NEW.question_id;
  IF NEW.workflow_state<>'DRAFT' OR NEW.provenance<>'AUTHORED' OR NEW.author_account_id IS DISTINCT FROM version_author OR NEW.approved_by_account_id IS NOT NULL OR NEW.revision_no<>0 THEN
   RAISE EXCEPTION 'New question versions must begin as authored Draft.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF (NEW.question_version_id,NEW.question_id,NEW.author_account_id,NEW.provenance) IS DISTINCT FROM (OLD.question_version_id,OLD.question_id,OLD.author_account_id,OLD.provenance) THEN
  RAISE EXCEPTION 'Question authorship and import provenance are immutable.' USING ERRCODE='55000';
 END IF;
 IF OLD.approved_by_account_id IS NOT NULL AND (NEW.approved_by_account_id,NEW.approved_at) IS DISTINCT FROM (OLD.approved_by_account_id,OLD.approved_at) THEN
  RAISE EXCEPTION 'Approval provenance is immutable.' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auth_sessions s JOIN auth_accounts a ON a.account_id=s.account_id JOIN auth_account_roles r ON r.account_id=a.account_id AND r.role='admin'
 WHERE s.session_id=NEW.transition_session_id AND s.account_id=NEW.transition_actor_account_id AND s.active_role='admin' AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND a.account_status='active') THEN
  RAISE EXCEPTION 'Question transition requires a live Admin session.' USING ERRCODE='42501';
 END IF;
 IF NOT (
 (OLD.workflow_state='DRAFT' AND NEW.workflow_state='UNDER_REVIEW' AND NEW.transition_actor_account_id=OLD.author_account_id)
 OR (OLD.workflow_state='UNDER_REVIEW' AND NEW.workflow_state IN ('CHANGES_REQUESTED','APPROVED') AND NEW.transition_actor_account_id<>OLD.author_account_id)
 OR (OLD.workflow_state='APPROVED' AND NEW.workflow_state='PUBLISHED')
 OR (OLD.workflow_state='PUBLISHED' AND NEW.workflow_state IN ('PAUSED','RETIRED'))
 OR (OLD.workflow_state='PAUSED' AND NEW.workflow_state IN ('PUBLISHED','RETIRED'))
 OR (NEW.workflow_state='ARCHIVED' AND OLD.workflow_state IN ('DRAFT','CHANGES_REQUESTED','APPROVED','RETIRED','PAUSED'))
 ) THEN RAISE EXCEPTION 'Invalid question lifecycle transition.' USING ERRCODE='23514'; END IF;
 IF NEW.workflow_state IN ('CHANGES_REQUESTED','RETIRED') AND (NEW.transition_reason IS NULL OR char_length(btrim(NEW.transition_reason))<3) THEN
  RAISE EXCEPTION 'A lifecycle reason is required.' USING ERRCODE='23514';
 END IF;
 IF NEW.workflow_state='APPROVED' THEN
  IF NEW.approved_by_account_id IS DISTINCT FROM NEW.transition_actor_account_id OR NEW.approved_at IS NULL THEN RAISE EXCEPTION 'Approval must identify its independent reviewer.' USING ERRCODE='23514'; END IF;
 ELSIF (NEW.approved_by_account_id,NEW.approved_at) IS DISTINCT FROM (OLD.approved_by_account_id,OLD.approved_at) THEN
  RAISE EXCEPTION 'Only independent approval may set approval provenance.' USING ERRCODE='23514';
 END IF;
 IF NEW.workflow_state IN ('UNDER_REVIEW','CHANGES_REQUESTED','APPROVED') AND NOT EXISTS(SELECT 1 FROM assessment_questions WHERE question_id=NEW.question_id AND authoring_version_id=NEW.question_version_id) THEN RAISE EXCEPTION 'Review must identify the exact current authoring version.' USING ERRCODE='23514'; END IF;
 IF NEW.workflow_state='ARCHIVED' AND OLD.workflow_state='PAUSED' AND EXISTS(SELECT 1 FROM assessment_questions WHERE question_id=NEW.question_id AND current_version_id=NEW.question_version_id) THEN RAISE EXCEPTION 'Retire the current publication before archive.' USING ERRCODE='23514'; END IF;
 IF NEW.workflow_state='PUBLISHED' AND OLD.workflow_state='PAUSED' AND NOT EXISTS(SELECT 1 FROM assessment_questions WHERE question_id=NEW.question_id AND current_version_id=NEW.question_version_id) THEN RAISE EXCEPTION 'Superseded publication cannot resume.' USING ERRCODE='23514'; END IF;
 IF NEW.workflow_state='PUBLISHED' AND OLD.workflow_state='APPROVED' AND NOT EXISTS(SELECT 1 FROM assessment_questions WHERE question_id=NEW.question_id AND authoring_version_id=NEW.question_version_id) THEN
  RAISE EXCEPTION 'Only the exact authoring version may be published.' USING ERRCODE='23514';
 END IF;
 NEW.revision_no=OLD.revision_no+1; NEW.updated_at=CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;
CREATE TRIGGER question_workflow_guard BEFORE INSERT OR UPDATE OR DELETE ON question_version_workflow FOR EACH ROW EXECUTE FUNCTION hse_question_workflow_guard();

CREATE FUNCTION hse_question_workflow_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO question_version_workflow_events(question_version_id,from_state,to_state,revision_no,actor_account_id,reason,provenance)
 VALUES(NEW.question_version_id,CASE WHEN TG_OP='UPDATE' THEN OLD.workflow_state ELSE NULL END,NEW.workflow_state,NEW.revision_no,NEW.transition_actor_account_id,NEW.transition_reason,NEW.provenance);
 RETURN NEW;
END $$;
CREATE TRIGGER question_workflow_event AFTER INSERT OR UPDATE ON question_version_workflow FOR EACH ROW EXECUTE FUNCTION hse_question_workflow_event();
CREATE TRIGGER question_workflow_events_append_only BEFORE UPDATE OR DELETE ON question_version_workflow_events FOR EACH ROW EXECUTE FUNCTION hse_question_version_append_only();

CREATE FUNCTION hse_question_version_draft() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO question_version_workflow(question_version_id,question_id,workflow_state,author_account_id,provenance)
 VALUES(NEW.question_version_id,NEW.question_id,'DRAFT',NEW.created_by_account_id,'AUTHORED');
 RETURN NEW;
END $$;
CREATE TRIGGER question_version_draft AFTER INSERT ON assessment_question_versions FOR EACH ROW EXECUTE FUNCTION hse_question_version_draft();

CREATE FUNCTION hse_question_publication_consistency() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE q assessment_questions%ROWTYPE; live_state TEXT; live_fingerprint TEXT;
BEGIN
 SELECT * INTO q FROM assessment_questions WHERE question_id=NEW.question_id;
 IF q.question_id IS NULL THEN RETURN NULL; END IF;
 IF q.authoring_version_id IS NULL OR (q.authoring_version_id IS DISTINCT FROM (SELECT v.question_version_id FROM assessment_question_versions v JOIN question_version_workflow w USING(question_version_id,question_id) WHERE v.question_id=q.question_id ORDER BY (w.workflow_state<>'ARCHIVED') DESC,v.version_no DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM question_version_workflow WHERE question_version_id=q.authoring_version_id AND workflow_state='ARCHIVED' AND q.authoring_version_id=q.current_version_id)) THEN
  RAISE EXCEPTION 'Question authoring pointer must identify the latest available workflow version.' USING ERRCODE='23514';
 END IF;
 SELECT w.workflow_state,v.content_fingerprint INTO live_state,live_fingerprint FROM question_version_workflow w JOIN assessment_question_versions v USING(question_version_id) WHERE w.question_id=q.question_id AND w.question_version_id=q.current_version_id;
 IF q.current_version_id IS NOT NULL AND q.current_content_fingerprint IS DISTINCT FROM live_fingerprint THEN RAISE EXCEPTION 'Question fingerprint does not match its immutable pointer.' USING ERRCODE='23514'; END IF;
 IF (q.question_status='ACTIVE') IS DISTINCT FROM COALESCE(live_state='PUBLISHED',false) OR EXISTS(SELECT 1 FROM question_version_workflow WHERE question_id=q.question_id AND workflow_state='PUBLISHED' AND question_version_id IS DISTINCT FROM q.current_version_id) THEN
  RAISE EXCEPTION 'Only the exact Published version can be active.' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER question_publication_consistency AFTER INSERT OR UPDATE ON assessment_questions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hse_question_publication_consistency();
CREATE CONSTRAINT TRIGGER question_workflow_publication_consistency AFTER INSERT OR UPDATE ON question_version_workflow DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hse_question_publication_consistency();

CREATE FUNCTION hse_question_pointer_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.current_version_id IS NOT NULL AND NEW.current_version_id IS DISTINCT FROM OLD.current_version_id AND NOT EXISTS(SELECT 1 FROM question_version_workflow WHERE question_version_id=NEW.current_version_id AND question_id=NEW.question_id AND workflow_state='PUBLISHED') THEN
  RAISE EXCEPTION 'Live pointer changes require exact approved publication.' USING ERRCODE='23514';
 END IF;
 IF OLD.authoring_version_id IS NOT NULL AND NEW.authoring_version_id IS DISTINCT FROM OLD.authoring_version_id AND EXISTS(SELECT 1 FROM question_version_workflow WHERE question_version_id=OLD.authoring_version_id AND workflow_state IN ('UNDER_REVIEW','APPROVED','RETIRED')) THEN
  RAISE EXCEPTION 'Resolve current review or retirement before revision.' USING ERRCODE='23514';
 END IF;
 IF OLD.authoring_version_id IS DISTINCT FROM NEW.authoring_version_id AND EXISTS(SELECT 1 FROM question_version_workflow WHERE question_version_id=OLD.authoring_version_id AND workflow_state='ARCHIVED') AND (OLD.authoring_version_id=OLD.current_version_id OR NEW.authoring_version_id IS DISTINCT FROM (SELECT v.question_version_id FROM assessment_question_versions v JOIN question_version_workflow w USING(question_version_id,question_id) WHERE v.question_id=NEW.question_id AND w.workflow_state<>'ARCHIVED' ORDER BY v.version_no DESC LIMIT 1)) THEN
  RAISE EXCEPTION 'Archived live content is terminal; draft archive may restore only its latest retained workflow version.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER question_pointer_guard BEFORE UPDATE ON assessment_questions FOR EACH ROW EXECUTE FUNCTION hse_question_pointer_guard();
CREATE FUNCTION hse_question_workflow_event_insert_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Workflow events are created only by a lifecycle transition.' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER question_workflow_event_insert_guard BEFORE INSERT ON question_version_workflow_events FOR EACH ROW EXECUTE FUNCTION hse_question_workflow_event_insert_guard();
