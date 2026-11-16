-- Existing frozen M1.07.05: a completed correction decision must reach the
-- owning Worker even when the proposed version was not promoted to current.
-- Preserve every existing event/role mapping in the installed wrapper stack.
ALTER FUNCTION platform_assurance_event_recipients(TEXT,TEXT)
  RENAME TO platform_assurance_event_recipients_before_verified_correction;

CREATE FUNCTION platform_assurance_event_recipients(p_type TEXT,p_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,
              notification_type TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH original AS (
  SELECT * FROM platform_assurance_event_recipients_before_verified_correction(p_type,p_ref)
 ), finalized_correction AS (
  SELECT accounts.account_id,'worker'::TEXT AS role,NULL::TEXT AS tenant_id,
   NULL::TEXT AS membership_id,p_type AS notification_type,
   'worker.identity.record'::TEXT AS target_key,identities.identity_id AS target_reference
  FROM platform_assurance_event_source(p_type,p_ref) source
  JOIN worker_identities identities ON identities.identity_id=source.record_ref
    AND identities.worker_account_id=source.worker_account_id
    AND identities.lifecycle_status='verified'
  JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id
    AND versions.identity_version_id=source.source_version
    AND versions.version_kind='correction'
    AND versions.submitted_at IS NOT NULL
  JOIN evidence_review_tasks tasks ON tasks.source_record_id=identities.identity_id
    AND tasks.source_version_id=versions.identity_version_id
    AND tasks.worker_account_id=identities.worker_account_id
    AND tasks.evidence_kind='identity'
  JOIN evidence_review_decisions decisions ON decisions.task_id=tasks.task_id
    AND decisions.source_version_id=versions.identity_version_id
    AND decisions.decision_id=split_part(p_ref,':',2)
    AND decisions.verifier_account_id=source.actor_account_id
  JOIN auth_accounts accounts ON accounts.account_id=identities.worker_account_id
    AND accounts.account_status='active'
  JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='worker'
  WHERE source.actor_role='verifier' AND p_ref ~ '^review:[A-Za-z0-9_-]{1,160}$'
    AND ((p_type='evidence.reviewed' AND decisions.outcome IN ('APPROVED','REJECTED'))
      OR (p_type='evidence.additional.requested' AND decisions.outcome='CHANGES_REQUESTED'))
 )
 SELECT * FROM original UNION SELECT * FROM finalized_correction;
$$;
