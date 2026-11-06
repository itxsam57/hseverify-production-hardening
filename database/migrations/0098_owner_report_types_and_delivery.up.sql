-- Fixed owner-scoped report definitions, snapshots and artifact-backed email delivery.
CREATE TABLE hse_report_expansion_rollback (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 job_type_expression TEXT NOT NULL, origin_expression TEXT NOT NULL);
INSERT INTO hse_report_expansion_rollback(job_type_expression,origin_expression)
 SELECT (SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint WHERE conrelid='platform_outbox_jobs'::regclass AND conname='platform_outbox_jobs_job_type_check'),
 (SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint WHERE conrelid='platform_outbox_jobs'::regclass AND conname='platform_outbox_enqueue_origin');
DO $$
DECLARE expression TEXT;
BEGIN
 SELECT job_type_expression INTO expression FROM hse_report_expansion_rollback;
 ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_jobs_job_type_check;
 EXECUTE format('ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_jobs_job_type_check CHECK ((%s) OR job_type=%L)',expression,'email.report.ready');
 SELECT origin_expression INTO expression FROM hse_report_expansion_rollback;
 ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_enqueue_origin;
 EXECUTE format('ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_enqueue_origin CHECK ((%s) OR (job_type=%L AND enqueued_system_component=%L AND enqueued_by_account_id IS NULL AND enqueued_by_role IS NULL AND tenant_id IS NULL AND membership_id IS NULL))',expression,'email.report.ready','outbox-worker');
END; $$;
ALTER TABLE platform_outbox_jobs ADD CONSTRAINT outbox_report_ready_payload_check CHECK (
 job_type<>'email.report.ready' OR (jsonb_typeof(payload)='object' AND payload ? 'deliveryRef'
 AND payload-'deliveryRef'='{}'::jsonb AND jsonb_typeof(payload->'deliveryRef')='string'
 AND payload->>'deliveryRef' ~ '^report_email_[A-Za-z0-9_-]{24}$'));

CREATE FUNCTION hse_report_headers(report_type TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
 SELECT CASE report_type
 WHEN 'workforce-status' THEN '["Worker ID","Worker link","Worker status","Site ID","Department ID","Company case status"]'::jsonb
 WHEN 'site-department-readiness' THEN '["Scope","Scope ID","Scope name","Cases","Assured","Conditional","Attention","In progress","Readiness %"]'::jsonb
 WHEN 'competency-gaps' THEN '["Case ID","Worker ID","Worker link","Competency target","Case status","Gap"]'::jsonb
 WHEN 'expiring-credentials' THEN '["Credential ID","Worker ID","Qualification","Issued at","Expires at","Status"]'::jsonb
 WHEN 'assessment-completion' THEN '["Case ID","Worker ID","Worker link","Attempt ID","Assessment","Status","Started at","Submitted at"]'::jsonb
 WHEN 'interview-outcomes' THEN '["Case ID","Worker ID","Worker link","Interview ID","Status","Scheduled at","Final recommendation"]'::jsonb
 WHEN 'failed-pending-cases' THEN '["Case ID","Worker ID","Worker link","Case status","Created at","Updated at"]'::jsonb
 WHEN 'credit-billing-usage' THEN '["Record type","Reference","Status","Credit change","Requested credits","Reserved credits","Amount minor","Currency","Recorded at"]'::jsonb
 WHEN 'identity-verification-summary' THEN '["Worker ID","Identity status","Identity version","Submitted at","Verified at"]'::jsonb
 WHEN 'qualification' THEN '["Evidence ID","Version","Title","Level","Institution","Awarded date","Status"]'::jsonb
 WHEN 'assessment-breakdown' THEN '["Case ID","Attempt ID","Assessment","Status","Question count","Submitted at","Final score","Final decision"]'::jsonb
 WHEN 'interview-summary' THEN '["Case ID","Interview ID","Status","Scheduled at","Final recommendation"]'::jsonb
 WHEN 'credential-pdf' THEN '["Credential ID","Worker ID","Qualification","Issued at","Expires at","Status","Authentication"]'::jsonb
 WHEN 'living-record-history' THEN '["Competency ID","Title","Source credential","Version","Status","Effective from","Expires at","Restrictions","Conditions"]'::jsonb
 WHEN 'reassessment-appeal-history' THEN '["Event type","Reference","Credential ID","Status","Version","Recorded at","Outcome"]'::jsonb
 ELSE NULL END
$$;
CREATE FUNCTION hse_report_snapshot_valid(kind TEXT,headers JSONB,rows JSONB) RETURNS BOOLEAN
 LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB; value JSONB;
BEGIN
 IF hse_report_headers(kind) IS NULL OR headers IS DISTINCT FROM hse_report_headers(kind)
  OR jsonb_typeof(rows)<>'array' OR jsonb_array_length(rows)>10000 THEN RETURN FALSE; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(rows) LOOP
  IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>jsonb_array_length(headers)
   OR NOT(item ?& ARRAY(SELECT jsonb_array_elements_text(headers))) THEN RETURN FALSE; END IF;
  FOR value IN SELECT v FROM jsonb_each(item) AS entries(k,v) LOOP
   IF jsonb_typeof(value)<>'string' OR char_length(value#>>'{}')>4096 THEN RETURN FALSE; END IF;
  END LOOP;
 END LOOP;
 RETURN TRUE;
END; $$;

-- Current account/membership/permission/unit authority; origin-session expiry is intentionally absent.
CREATE FUNCTION hse_report_owner_access(owner_kind TEXT,account_ref TEXT,tenant_ref TEXT,member_ref TEXT,scope JSONB,kind TEXT)
 RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE member auth_tenant_memberships%ROWTYPE; restriction RECORD; required_permission TEXT;
BEGIN
 PERFORM 1 FROM auth_accounts accounts JOIN auth_account_roles roles USING(account_id)
  WHERE accounts.account_id=account_ref AND accounts.account_status='active' AND accounts.email_verified_at IS NOT NULL
   AND roles.role=owner_kind FOR UPDATE OF accounts,roles;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF owner_kind='worker' THEN
  RETURN tenant_ref IS NULL AND member_ref IS NULL AND scope='{}'::jsonb
   AND kind IN ('identity-verification-summary','qualification','assessment-breakdown','interview-summary','credential-pdf','living-record-history','reassessment-appeal-history');
 END IF;
 IF owner_kind<>'company' OR kind NOT IN ('workforce-status','site-department-readiness','competency-gaps','expiring-credentials','assessment-completion','interview-outcomes','failed-pending-cases','credit-billing-usage') THEN RETURN FALSE; END IF;
 SELECT memberships.* INTO member FROM auth_tenant_memberships memberships
  JOIN platform_tenants tenants ON tenants.tenant_id=memberships.tenant_id
  WHERE memberships.membership_id=member_ref AND memberships.account_id=account_ref AND memberships.tenant_id=tenant_ref
   AND memberships.portal_role='company' AND memberships.membership_status='active' AND tenants.tenant_status='active'
  FOR UPDATE OF memberships,tenants;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 required_permission:=CASE WHEN kind='credit-billing-usage' THEN 'company.billing.read'
  WHEN kind='workforce-status' THEN 'company.workforce.read' ELSE 'company.orders.read' END;
 IF EXISTS (SELECT 1 FROM unnest(ARRAY['company.reports.export',required_permission]) required(permission)
  WHERE NOT EXISTS (SELECT 1 FROM auth_tenant_role_permission_ceiling ceiling
    WHERE ceiling.membership_role=member.membership_role AND ceiling.permission_key=required.permission)
  OR EXISTS(SELECT 1 FROM auth_tenant_permission_overrides denied WHERE denied.membership_id=member_ref
   AND denied.membership_role=member.membership_role AND denied.permission_key=required.permission AND denied.effect='deny')) THEN RETURN FALSE; END IF;
 IF jsonb_typeof(scope)<>'object' OR scope-ARRAY['siteId','departmentId']<>'{}'::jsonb
  OR NOT(scope ?& ARRAY['siteId','departmentId']) THEN RETURN FALSE; END IF;
 SELECT site_id,department_id INTO restriction FROM company_team_unit_assignments
  WHERE tenant_id=tenant_ref AND membership_id=member_ref AND ended_at IS NULL FOR UPDATE;
 IF FOUND AND ((restriction.site_id IS NOT NULL AND scope->>'siteId' IS DISTINCT FROM restriction.site_id)
  OR (restriction.department_id IS NOT NULL AND scope->>'departmentId' IS DISTINCT FROM restriction.department_id)
  OR kind='credit-billing-usage') THEN RETURN FALSE; END IF;
 IF kind='credit-billing-usage' AND (scope->>'siteId' IS NOT NULL OR scope->>'departmentId' IS NOT NULL) THEN RETURN FALSE; END IF;
 IF scope->>'siteId' IS NOT NULL THEN
  PERFORM 1 FROM company_sites WHERE tenant_id=tenant_ref AND site_id=scope->>'siteId' AND site_status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
 END IF;
 IF scope->>'departmentId' IS NOT NULL THEN
  PERFORM 1 FROM company_departments WHERE tenant_id=tenant_ref AND department_id=scope->>'departmentId' AND department_status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
 END IF;
 RETURN TRUE;
END; $$;

CREATE TABLE report_definitions (
 definition_id TEXT PRIMARY KEY CHECK(definition_id ~ '^report_definition_[A-Za-z0-9_-]{24}$'),
 owner_kind TEXT NOT NULL CHECK(owner_kind IN ('company','worker')),
 requested_by TEXT NOT NULL REFERENCES auth_accounts(account_id),
 tenant_id TEXT NULL REFERENCES platform_tenants(tenant_id),
 membership_id TEXT NULL REFERENCES auth_tenant_memberships(membership_id),
 current_version INTEGER NOT NULL CHECK(current_version BETWEEN 1 AND 1000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((owner_kind='company' AND tenant_id IS NOT NULL AND membership_id IS NOT NULL)
  OR (owner_kind='worker' AND tenant_id IS NULL AND membership_id IS NULL))
);
CREATE TABLE report_definition_versions (
 definition_id TEXT NOT NULL REFERENCES report_definitions(definition_id), version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000),
 name TEXT NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 120),
 report_type TEXT NOT NULL CHECK(hse_report_headers(report_type) IS NOT NULL),
 format TEXT NOT NULL CHECK(format IN ('csv','pdf','print')), request_scope JSONB NOT NULL, request_filters JSONB NOT NULL,
 queue_email BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(definition_id,version),
 CHECK(jsonb_typeof(request_scope)='object' AND jsonb_typeof(request_filters)='object')
);
ALTER TABLE report_definitions ADD CONSTRAINT report_definition_current_version_fk FOREIGN KEY(definition_id,current_version)
 REFERENCES report_definition_versions(definition_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION hse_report_definition_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner RECORD;
BEGIN
 IF TG_TABLE_NAME='report_definition_versions' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Saved report versions are immutable' USING ERRCODE='55000'; END IF;
  SELECT * INTO owner FROM report_definitions WHERE definition_id=NEW.definition_id FOR UPDATE;
  IF NOT FOUND OR NOT hse_report_owner_access(owner.owner_kind,owner.requested_by,owner.tenant_id,owner.membership_id,NEW.request_scope,NEW.report_type)
   OR NEW.version<>owner.current_version THEN RAISE EXCEPTION 'Saved report owner is invalid' USING ERRCODE='55000'; END IF;
 ELSE
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Saved report ownership is immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (ROW(NEW.definition_id,NEW.owner_kind,NEW.requested_by,NEW.tenant_id,NEW.membership_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.definition_id,OLD.owner_kind,OLD.requested_by,OLD.tenant_id,OLD.membership_id,OLD.created_at)
    OR NEW.current_version<>OLD.current_version+1) THEN RAISE EXCEPTION 'Saved report version update is invalid' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER report_definition_guard BEFORE UPDATE OR DELETE ON report_definitions FOR EACH ROW EXECUTE FUNCTION hse_report_definition_guard();
CREATE TRIGGER report_definition_version_guard BEFORE INSERT OR UPDATE OR DELETE ON report_definition_versions FOR EACH ROW EXECUTE FUNCTION hse_report_definition_guard();

ALTER TABLE report_deliveries DROP CONSTRAINT report_delivery_type_check;
ALTER TABLE report_deliveries ADD CONSTRAINT report_delivery_type_check CHECK(report_type IN ('workforce-status','site-department-readiness','competency-gaps','expiring-credentials','assessment-completion','interview-outcomes','failed-pending-cases','credit-billing-usage'));
ALTER TABLE report_deliveries ADD COLUMN snapshot_headers JSONB NOT NULL DEFAULT '["Worker ID","Worker link","Worker status","Site ID","Department ID","Company case status"]'::jsonb,
 ADD COLUMN source_provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN request_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN queue_email BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN recipient_address_hash TEXT NULL,
 ADD COLUMN definition_id TEXT NULL, ADD COLUMN definition_version INTEGER NULL,
 ADD CONSTRAINT report_delivery_definition_fk FOREIGN KEY(definition_id,definition_version) REFERENCES report_definition_versions(definition_id,version),
 ADD CONSTRAINT report_delivery_definition_pair CHECK((definition_id IS NULL)=(definition_version IS NULL)),
 ADD CONSTRAINT report_delivery_source_json CHECK(jsonb_typeof(source_provenance)='array' AND jsonb_typeof(request_filters)='object'),
 ADD CONSTRAINT report_delivery_email_intent CHECK((queue_email AND recipient_address_hash IS NOT NULL AND recipient_address_hash ~ '^[a-f0-9]{64}$') OR (NOT queue_email AND recipient_address_hash IS NULL)),
 ADD CONSTRAINT report_delivery_fixed_snapshot CHECK(snapshot_rows IS NULL OR hse_report_snapshot_valid(report_type,snapshot_headers,snapshot_rows));

CREATE TABLE worker_report_deliveries (
 report_id TEXT PRIMARY KEY CHECK(report_id ~ '^report_worker_[A-Za-z0-9_-]{24}$'),
 requested_by TEXT NOT NULL REFERENCES auth_accounts(account_id), report_type TEXT NOT NULL CHECK(report_type IN ('identity-verification-summary','qualification','assessment-breakdown','interview-summary','credential-pdf','living-record-history','reassessment-appeal-history')),
 format TEXT NOT NULL CHECK(format IN ('csv','pdf','print')), status TEXT NOT NULL CHECK(status IN ('queued','scheduled','processing','delivered','failed')),
 delivery_key TEXT NOT NULL UNIQUE, schedule_at TIMESTAMPTZ NULL, requested_at TIMESTAMPTZ NOT NULL,
 request_scope JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(request_scope='{}'::jsonb), snapshot_headers JSONB NOT NULL,
 snapshot_rows JSONB NOT NULL, source_provenance JSONB NOT NULL, request_filters JSONB NOT NULL,
 generation_job_id TEXT NOT NULL UNIQUE REFERENCES platform_outbox_jobs(job_id), generation_version INTEGER NOT NULL DEFAULT 1 CHECK(generation_version BETWEEN 1 AND 5),
 artifact_key TEXT NULL, artifact_sha256 TEXT NULL, artifact_byte_size INTEGER NULL, artifact_mime_type TEXT NULL,
 generated_at TIMESTAMPTZ NULL, last_error_code TEXT NULL, queue_email BOOLEAN NOT NULL DEFAULT FALSE,
 recipient_address_hash TEXT NULL, definition_id TEXT NULL, definition_version INTEGER NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(definition_id,definition_version) REFERENCES report_definition_versions(definition_id,version),
 CHECK((definition_id IS NULL)=(definition_version IS NULL)),
 CHECK(hse_report_snapshot_valid(report_type,snapshot_headers,snapshot_rows)),
 CHECK(jsonb_typeof(source_provenance)='array' AND jsonb_typeof(request_filters)='object'),
 CHECK((queue_email AND recipient_address_hash IS NOT NULL AND recipient_address_hash ~ '^[a-f0-9]{64}$') OR (NOT queue_email AND recipient_address_hash IS NULL)),
 CHECK((status<>'delivered' AND artifact_key IS NULL AND artifact_sha256 IS NULL AND artifact_byte_size IS NULL
  AND artifact_mime_type IS NULL AND generated_at IS NULL) OR
  (status='delivered' AND artifact_key IS NOT NULL AND artifact_sha256 IS NOT NULL AND artifact_byte_size IS NOT NULL AND artifact_mime_type IS NOT NULL AND artifact_key ~ '^secure-files/[a-f0-9]{64}$' AND artifact_sha256 ~ '^[a-f0-9]{64}$'
   AND artifact_byte_size>0 AND artifact_mime_type IN ('text/csv; charset=utf-8','application/pdf','text/html; charset=utf-8')
   AND generated_at IS NOT NULL))
);
CREATE INDEX worker_report_requester_idx ON worker_report_deliveries(requested_by,created_at DESC);

CREATE FUNCTION hse_report_configuration_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_label TEXT; member_ref TEXT; tenant_ref TEXT; definition RECORD; expected_hash TEXT;
BEGIN
 owner_label:=CASE WHEN TG_TABLE_NAME='report_deliveries' THEN 'company' ELSE 'worker' END;
 IF owner_label='company' THEN member_ref:=NEW.requested_by_membership_id;tenant_ref:=NEW.tenant_id; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.snapshot_headers,NEW.source_provenance,NEW.request_filters,NEW.queue_email,
   NEW.recipient_address_hash,NEW.definition_id,NEW.definition_version)
  IS DISTINCT FROM ROW(OLD.snapshot_headers,OLD.source_provenance,OLD.request_filters,OLD.queue_email,
   OLD.recipient_address_hash,OLD.definition_id,OLD.definition_version) THEN
  RAISE EXCEPTION 'Report configuration provenance is immutable' USING ERRCODE='55000';
 END IF;
 IF TG_OP='INSERT' THEN
  IF owner_label='company' AND NEW.report_id ~ '^report_worker_' THEN RAISE EXCEPTION 'Worker report namespace is reserved' USING ERRCODE='55000'; END IF;
  IF NOT hse_report_owner_access(owner_label,NEW.requested_by,tenant_ref,member_ref,NEW.request_scope,NEW.report_type)
   THEN RAISE EXCEPTION 'Report source access is invalid' USING ERRCODE='55000'; END IF;
  IF NEW.queue_email THEN
   SELECT encode(sha256(convert_to(lower(btrim(email_normalized)),'UTF8')),'hex') INTO expected_hash
    FROM auth_accounts WHERE account_id=NEW.requested_by AND email_verified_at IS NOT NULL FOR UPDATE;
   IF expected_hash IS NULL OR NEW.recipient_address_hash IS DISTINCT FROM expected_hash THEN
    RAISE EXCEPTION 'Report recipient must be its verified owner' USING ERRCODE='55000';
   END IF;
  END IF;
  IF NEW.definition_id IS NOT NULL THEN
   SELECT versions.* INTO definition FROM report_definition_versions versions JOIN report_definitions owners USING(definition_id)
    WHERE versions.definition_id=NEW.definition_id AND versions.version=NEW.definition_version
    AND owners.owner_kind=owner_label AND owners.requested_by=NEW.requested_by
    AND owners.tenant_id IS NOT DISTINCT FROM tenant_ref AND owners.membership_id IS NOT DISTINCT FROM member_ref;
   IF NOT FOUND OR ROW(definition.report_type,definition.format,definition.request_scope,definition.request_filters,definition.queue_email)
    IS DISTINCT FROM ROW(NEW.report_type,NEW.format,NEW.request_scope,NEW.request_filters,NEW.queue_email) THEN
    RAISE EXCEPTION 'Report does not match its saved version' USING ERRCODE='55000';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER report_configuration_guard BEFORE INSERT OR UPDATE ON report_deliveries FOR EACH ROW EXECUTE FUNCTION hse_report_configuration_guard();
CREATE TRIGGER worker_report_configuration_guard BEFORE INSERT OR UPDATE ON worker_report_deliveries FOR EACH ROW EXECUTE FUNCTION hse_report_configuration_guard();

CREATE FUNCTION hse_worker_report_provenance_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.report_id,NEW.requested_by,NEW.report_type,NEW.format,NEW.requested_at,
  NEW.request_scope,NEW.snapshot_rows,NEW.schedule_at,NEW.delivery_key,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.report_id,OLD.requested_by,OLD.report_type,OLD.format,OLD.requested_at,
  OLD.request_scope,OLD.snapshot_rows,OLD.schedule_at,OLD.delivery_key,OLD.created_at) THEN
  RAISE EXCEPTION 'Worker report request provenance is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='delivered' AND ROW(NEW.status,NEW.artifact_key,NEW.artifact_sha256,
  NEW.artifact_byte_size,NEW.artifact_mime_type,NEW.generated_at,NEW.generation_job_id,NEW.generation_version)
  IS DISTINCT FROM ROW(OLD.status,OLD.artifact_key,OLD.artifact_sha256,
  OLD.artifact_byte_size,OLD.artifact_mime_type,OLD.generated_at,OLD.generation_job_id,OLD.generation_version) THEN
  RAISE EXCEPTION 'Worker report artifact provenance is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' OR NEW.generation_job_id IS DISTINCT FROM OLD.generation_job_id THEN
  IF NOT EXISTS(SELECT 1 FROM platform_outbox_jobs jobs WHERE jobs.job_id=NEW.generation_job_id
   AND jobs.job_type='report.generation' AND jobs.schema_version=1 AND jobs.status='pending'
   AND jobs.enqueued_by_account_id=NEW.requested_by AND jobs.enqueued_by_role='worker' AND jobs.enqueued_system_component IS NULL
   AND jobs.tenant_id IS NULL AND jobs.membership_id IS NULL AND jobs.payload=jsonb_build_object('reportRef',NEW.report_id)) THEN
   RAISE EXCEPTION 'Worker report job provenance is invalid' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (OLD.status='delivered' OR NEW.status<>'queued' OR NEW.generation_version<>OLD.generation_version+1
   OR NOT EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE job_id=OLD.generation_job_id AND status='terminal_failed')) THEN
   RAISE EXCEPTION 'Worker report retry is invalid' USING ERRCODE='55000'; END IF;
 ELSIF NEW.generation_version IS DISTINCT FROM OLD.generation_version THEN
  RAISE EXCEPTION 'Worker report generation is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER worker_report_provenance_guard BEFORE INSERT OR UPDATE ON worker_report_deliveries
 FOR EACH ROW EXECUTE FUNCTION hse_worker_report_provenance_guard();

CREATE TABLE report_email_deliveries (
 delivery_ref TEXT PRIMARY KEY CHECK(delivery_ref ~ '^report_email_[A-Za-z0-9_-]{24}$'),
 owner_kind TEXT NOT NULL CHECK(owner_kind IN ('company','worker')), requested_by TEXT NOT NULL REFERENCES auth_accounts(account_id),
 tenant_id TEXT NULL REFERENCES platform_tenants(tenant_id), membership_id TEXT NULL REFERENCES auth_tenant_memberships(membership_id),
 report_id TEXT NOT NULL, generation_job_id TEXT NOT NULL UNIQUE REFERENCES platform_outbox_jobs(job_id),
 generation_version INTEGER NOT NULL CHECK(generation_version BETWEEN 1 AND 5),
 send_job_id TEXT NOT NULL UNIQUE REFERENCES platform_outbox_jobs(job_id),
 artifact_key TEXT NOT NULL CHECK(artifact_key ~ '^secure-files/[a-f0-9]{64}$'),
 artifact_sha256 TEXT NOT NULL CHECK(artifact_sha256 ~ '^[a-f0-9]{64}$'),
 artifact_byte_size INTEGER NOT NULL CHECK(artifact_byte_size>0), artifact_mime_type TEXT NOT NULL,
 recipient_address_hash TEXT NOT NULL CHECK(recipient_address_hash ~ '^[a-f0-9]{64}$'),
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','retry_wait','sent','failed')),
 first_dispatch_at TIMESTAMPTZ NULL, provider_reference_hash TEXT NULL, sent_at TIMESTAMPTZ NULL,
 last_error_code TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((owner_kind='company' AND tenant_id IS NOT NULL AND membership_id IS NOT NULL)
  OR (owner_kind='worker' AND tenant_id IS NULL AND membership_id IS NULL)),
 CHECK((status='sent' AND provider_reference_hash IS NOT NULL AND provider_reference_hash ~ '^[a-f0-9]{64}$' AND sent_at IS NOT NULL AND first_dispatch_at IS NOT NULL)
  OR (status<>'sent' AND provider_reference_hash IS NULL AND sent_at IS NULL))
);

-- Only the canonical active generation lease can create the fixed owner-only email follow-up.
CREATE FUNCTION hse_report_ready_source(generation_ref TEXT) RETURNS TABLE(
 owner_kind TEXT,requested_by TEXT,tenant_id TEXT,membership_id TEXT,report_id TEXT,generation_job_id TEXT,generation_version INTEGER,
 artifact_key TEXT,artifact_sha256 TEXT,artifact_byte_size INTEGER,artifact_mime_type TEXT,recipient_address_hash TEXT,request_scope JSONB,report_type TEXT)
 LANGUAGE SQL STABLE AS $$
 SELECT 'company',reports.requested_by,reports.tenant_id,reports.requested_by_membership_id,reports.report_id,reports.generation_job_id,reports.generation_version,
 reports.artifact_key,reports.artifact_sha256,reports.artifact_byte_size,reports.artifact_mime_type,reports.recipient_address_hash,reports.request_scope,reports.report_type
 FROM report_deliveries reports WHERE reports.generation_job_id=generation_ref AND reports.status='delivered' AND reports.queue_email
 UNION ALL
 SELECT 'worker',reports.requested_by,NULL::text,NULL::text,reports.report_id,reports.generation_job_id,reports.generation_version,
 reports.artifact_key,reports.artifact_sha256,reports.artifact_byte_size,reports.artifact_mime_type,reports.recipient_address_hash,reports.request_scope,reports.report_type
 FROM worker_report_deliveries reports WHERE reports.generation_job_id=generation_ref AND reports.status='delivered' AND reports.queue_email
$$;
CREATE FUNCTION hse_report_ready_assert_source(source RECORD,generation platform_outbox_jobs) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE expected_key TEXT;
BEGIN
 IF generation.job_type<>'report.generation' OR generation.schema_version<>1 OR generation.status<>'leased'
  OR generation.lease_expires_at<=clock_timestamp() OR generation.enqueued_system_component IS NOT NULL
  OR generation.enqueued_by_account_id IS DISTINCT FROM source.requested_by OR generation.enqueued_by_role IS DISTINCT FROM source.owner_kind
  OR generation.tenant_id IS DISTINCT FROM source.tenant_id OR generation.membership_id IS DISTINCT FROM source.membership_id
  OR generation.payload IS DISTINCT FROM jsonb_build_object('reportRef',source.report_id)
  OR NOT hse_report_owner_access(source.owner_kind,source.requested_by,source.tenant_id,source.membership_id,source.request_scope,source.report_type) THEN
  RAISE EXCEPTION 'Report email source is invalid' USING ERRCODE='55000'; END IF;
 -- PostgreSQL text cannot contain NUL; bytea construction below preserves the runtime key's exact separator.
 expected_key:='secure-files/'||encode(sha256(
  convert_to(CASE WHEN source.owner_kind='company' THEN source.tenant_id ELSE 'worker' END,'UTF8')||decode('00','hex')||
  convert_to(CASE WHEN source.owner_kind='company' THEN source.membership_id ELSE source.requested_by END,'UTF8')||decode('00','hex')||
  convert_to(source.report_id,'UTF8')||decode('00','hex')||convert_to(source.artifact_sha256,'UTF8')),'hex');
 -- The verified address hash was validated when this immutable report intent was created.
 -- Fresh address equality belongs to dispatch; changing it cannot undo report generation.
 IF source.artifact_key IS DISTINCT FROM expected_key OR source.recipient_address_hash IS NULL
  OR source.recipient_address_hash !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Report email artifact or recipient is invalid' USING ERRCODE='55000'; END IF;
END; $$;

CREATE FUNCTION hse_report_ready_job_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE source RECORD; generation platform_outbox_jobs%ROWTYPE; expected_key TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.job_id,NEW.job_type,NEW.schema_version,NEW.idempotency_key,NEW.payload,NEW.enqueued_by_account_id,
   NEW.enqueued_by_role,NEW.enqueued_system_component,NEW.tenant_id,NEW.membership_id)
   IS DISTINCT FROM ROW(OLD.job_id,OLD.job_type,OLD.schema_version,OLD.idempotency_key,OLD.payload,OLD.enqueued_by_account_id,
   OLD.enqueued_by_role,OLD.enqueued_system_component,OLD.tenant_id,OLD.membership_id) THEN
   RAISE EXCEPTION 'Report email job provenance is immutable' USING ERRCODE='55000'; END IF;
 ELSE
  SELECT sources.* INTO source FROM platform_outbox_jobs jobs CROSS JOIN LATERAL hse_report_ready_source(jobs.job_id) sources
   WHERE 'report_email_'||substr(encode(sha256(convert_to('email.report.ready:'||jobs.job_id,'UTF8')),'hex'),1,24)=NEW.payload->>'deliveryRef';
  IF NOT FOUND THEN RAISE EXCEPTION 'Report email requires its canonical delivered artifact' USING ERRCODE='55000'; END IF;
  SELECT * INTO generation FROM platform_outbox_jobs WHERE job_id=source.generation_job_id FOR UPDATE;
  PERFORM hse_report_ready_assert_source(source,generation);
  expected_key:=encode(sha256(convert_to('email.report.ready:'||generation.job_id,'UTF8')),'hex');
  IF NEW.job_id IS DISTINCT FROM 'job_'||substr(expected_key,1,24) OR NEW.idempotency_key IS DISTINCT FROM expected_key
   OR NEW.payload IS DISTINCT FROM jsonb_build_object('deliveryRef','report_email_'||substr(expected_key,1,24))
   OR NEW.status<>'pending' OR NEW.attempt_count<>0 OR NEW.enqueued_system_component IS DISTINCT FROM 'outbox-worker'
   OR NEW.enqueued_by_account_id IS NOT NULL OR NEW.enqueued_by_role IS NOT NULL OR NEW.tenant_id IS NOT NULL OR NEW.membership_id IS NOT NULL THEN
   RAISE EXCEPTION 'Report email requires a fixed trusted follow-up job' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER report_ready_job_insert_guard BEFORE INSERT ON platform_outbox_jobs FOR EACH ROW
 WHEN(NEW.job_type='email.report.ready') EXECUTE FUNCTION hse_report_ready_job_guard();
CREATE TRIGGER report_ready_job_update_guard BEFORE UPDATE ON platform_outbox_jobs FOR EACH ROW
 WHEN(OLD.job_type='email.report.ready' OR NEW.job_type='email.report.ready') EXECUTE FUNCTION hse_report_ready_job_guard();

CREATE FUNCTION hse_report_email_delivery_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE source RECORD; generation platform_outbox_jobs%ROWTYPE; expected_key TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.delivery_ref,NEW.owner_kind,NEW.requested_by,NEW.tenant_id,NEW.membership_id,NEW.report_id,
   NEW.generation_job_id,NEW.generation_version,NEW.send_job_id,NEW.artifact_key,NEW.artifact_sha256,
   NEW.artifact_byte_size,NEW.artifact_mime_type,NEW.recipient_address_hash,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.delivery_ref,OLD.owner_kind,OLD.requested_by,OLD.tenant_id,OLD.membership_id,OLD.report_id,
   OLD.generation_job_id,OLD.generation_version,OLD.send_job_id,OLD.artifact_key,OLD.artifact_sha256,
   OLD.artifact_byte_size,OLD.artifact_mime_type,OLD.recipient_address_hash,OLD.created_at)
   OR (OLD.first_dispatch_at IS NOT NULL AND NEW.first_dispatch_at IS DISTINCT FROM OLD.first_dispatch_at)
   OR (OLD.status='sent' AND ROW(NEW.status,NEW.provider_reference_hash,NEW.sent_at) IS DISTINCT FROM ROW(OLD.status,OLD.provider_reference_hash,OLD.sent_at))
   OR (OLD.status='failed' AND NEW.status<>'failed') THEN
   RAISE EXCEPTION 'Report email delivery provenance is immutable' USING ERRCODE='55000'; END IF;
 ELSE
  SELECT * INTO source FROM hse_report_ready_source(NEW.generation_job_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Report email delivery source is unavailable' USING ERRCODE='55000'; END IF;
  SELECT * INTO generation FROM platform_outbox_jobs WHERE job_id=NEW.generation_job_id FOR UPDATE;
  PERFORM hse_report_ready_assert_source(source,generation);
  expected_key:=encode(sha256(convert_to('email.report.ready:'||generation.job_id,'UTF8')),'hex');
  IF ROW(NEW.owner_kind,NEW.requested_by,NEW.tenant_id,NEW.membership_id,NEW.report_id,NEW.generation_version,
   NEW.artifact_key,NEW.artifact_sha256,NEW.artifact_byte_size,NEW.artifact_mime_type,NEW.recipient_address_hash)
   IS DISTINCT FROM ROW(source.owner_kind,source.requested_by,source.tenant_id,source.membership_id,source.report_id,source.generation_version,
   source.artifact_key,source.artifact_sha256,source.artifact_byte_size,source.artifact_mime_type,source.recipient_address_hash)
   OR NEW.delivery_ref IS DISTINCT FROM 'report_email_'||substr(expected_key,1,24)
   OR NEW.send_job_id IS DISTINCT FROM 'job_'||substr(expected_key,1,24) OR NEW.status<>'queued'
   OR NEW.first_dispatch_at IS NOT NULL OR NEW.provider_reference_hash IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM platform_outbox_jobs jobs WHERE jobs.job_id=NEW.send_job_id
    AND jobs.status='pending' AND jobs.job_type='email.report.ready' AND jobs.payload=jsonb_build_object('deliveryRef',NEW.delivery_ref)) THEN
   RAISE EXCEPTION 'Report email delivery does not match its immutable source' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER report_email_delivery_guard BEFORE INSERT OR UPDATE ON report_email_deliveries
 FOR EACH ROW EXECUTE FUNCTION hse_report_email_delivery_guard();

CREATE FUNCTION hse_enqueue_report_ready_email(generation_ref TEXT,lease_ref TEXT,worker_ref TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE generation platform_outbox_jobs%ROWTYPE; source RECORD; expected_key TEXT; v_delivery_ref TEXT; v_job_ref TEXT;
BEGIN
 SELECT * INTO generation FROM platform_outbox_jobs WHERE job_id=generation_ref FOR UPDATE;
 IF NOT FOUND OR generation.lease_id IS DISTINCT FROM lease_ref OR generation.worker_id IS DISTINCT FROM worker_ref
  OR generation.status<>'leased' OR generation.lease_expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Report email requires a current generation lease' USING ERRCODE='55000'; END IF;
 SELECT * INTO source FROM hse_report_ready_source(generation_ref);
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM hse_report_ready_assert_source(source,generation);
 expected_key:=encode(sha256(convert_to('email.report.ready:'||generation_ref,'UTF8')),'hex');
 v_delivery_ref:='report_email_'||substr(expected_key,1,24);v_job_ref:='job_'||substr(expected_key,1,24);
 IF EXISTS(SELECT 1 FROM report_email_deliveries emails WHERE emails.generation_job_id=generation_ref AND emails.delivery_ref=v_delivery_ref) THEN RETURN v_delivery_ref; END IF;
 INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,
  enqueued_by_role,enqueued_system_component,tenant_id,membership_id,status,attempt_count,max_attempts,next_attempt_at)
 VALUES(v_job_ref,'email.report.ready',1,expected_key,jsonb_build_object('deliveryRef',v_delivery_ref),NULL,NULL,'outbox-worker',NULL,NULL,'pending',0,5,clock_timestamp());
 INSERT INTO report_email_deliveries(delivery_ref,owner_kind,requested_by,tenant_id,membership_id,report_id,generation_job_id,generation_version,
  send_job_id,artifact_key,artifact_sha256,artifact_byte_size,artifact_mime_type,recipient_address_hash)
 VALUES(v_delivery_ref,source.owner_kind,source.requested_by,source.tenant_id,source.membership_id,source.report_id,generation_ref,source.generation_version,
  v_job_ref,source.artifact_key,source.artifact_sha256,source.artifact_byte_size,source.artifact_mime_type,source.recipient_address_hash);
 RETURN v_delivery_ref;
END; $$;
