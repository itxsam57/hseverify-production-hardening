import "server-only";
import type { DatabaseClient } from "@/lib/database/database";
import { DatabaseWorkerEvidenceRepository } from "@/lib/worker-evidence/worker-evidence-repository";

/** Current, owner-scoped data. Never exports authentication material or assessment questions. */
export async function collectWorkerPrivacyData(database: DatabaseClient, workerId: string, generatedAt: string) {
  const rows = async (sql: string) => (await database.query<Record<string, unknown>>(sql,[workerId])).rows;
  const accounts = await rows(`SELECT account_id,email_normalized,phone_e164,display_name,account_status,
    worker_reference,email_verified_at,phone_verified_at,created_at,updated_at
    FROM auth_accounts WHERE account_id=$1
    AND EXISTS(SELECT 1 FROM auth_account_roles WHERE account_id=$1 AND role='worker')`);
  if (accounts.length !== 1) throw new Error("Worker data is unavailable.");
  const evidenceRepository = new DatabaseWorkerEvidenceRepository(Promise.resolve(database));
  const currentEvidence = await evidenceRepository.listCurrentForWorker(workerId);
  const evidence = await Promise.all(currentEvidence.map(async record => ({
    ...record, versions: await evidenceRepository.listVersionsForWorker(workerId,record.recordId)
  })));
  return {
    formatVersion: 1, generatedAt, account: accounts[0], evidence,
    identityVersions: await rows(`SELECT versions.identity_version_id,versions.version_number,versions.version_kind,
      versions.version_status,versions.created_at,versions.submitted_at,
      drafts.legal_first_name,drafts.legal_last_name,drafts.previous_legal_name,drafts.date_of_birth,
      drafts.nationality,drafts.country_of_residence,drafts.verified_email_normalized,
      drafts.verified_phone_e164,drafts.updated_at
      FROM worker_identity_versions versions JOIN worker_identities identities USING(identity_id)
      LEFT JOIN worker_identity_version_drafts drafts USING(identity_version_id)
      WHERE identities.worker_account_id=$1 ORDER BY versions.created_at,versions.identity_version_id`),
    identityEvidence: await rows(`SELECT binding_id,bindings.identity_version_id,purpose,secure_file_id,
      document_type,document_number,issue_date,expiry_date,binding_status,bindings.created_at,superseded_at
      FROM worker_identity_evidence_bindings bindings
      JOIN worker_identity_versions versions USING(identity_version_id)
      JOIN worker_identities identities USING(identity_id)
      WHERE bindings.worker_account_id=$1 AND identities.worker_account_id=$1 ORDER BY bindings.created_at,binding_id`),
    cases: await rows(`SELECT case_id,case_status,next_action,created_at,updated_at,closed_at
      FROM assurance_cases WHERE worker_account_id=$1 ORDER BY created_at,case_id`),
    assessmentAttempts: await rows(`SELECT attempts.attempt_id,attempts.case_id,attempts.status,
      attempts.question_count,attempts.started_at,attempts.submitted_at,attempts.created_at,attempts.updated_at
      FROM assessment_attempts attempts JOIN assurance_cases cases ON cases.case_id=attempts.case_id
      WHERE attempts.worker_account_id=$1 AND cases.worker_account_id=$1 ORDER BY attempts.created_at,attempts.attempt_id`),
    assessmentAnswers: await rows(`SELECT answers.answer_id,answers.attempt_id,answers.position,
      answers.question_type,answers.text_value,answers.boolean_value,answers.numeric_value,answers.committed_at,
      CASE WHEN latest.revision_id IS NULL THEN answers.text_value ELSE latest.text_value END AS current_text_value,
      CASE WHEN latest.revision_id IS NULL THEN answers.boolean_value ELSE latest.boolean_value END AS current_boolean_value,
      CASE WHEN latest.revision_id IS NULL THEN answers.numeric_value ELSE latest.numeric_value END AS current_numeric_value,
      latest.revision_no AS current_revision_no,latest.revised_at AS current_revised_at
      FROM assessment_attempt_answers answers JOIN assessment_attempts attempts USING(attempt_id)
      JOIN assurance_cases cases ON cases.case_id=attempts.case_id
      LEFT JOIN LATERAL (
        SELECT revision_id,text_value,boolean_value,numeric_value,revision_no,revised_at
        FROM assessment_answer_revisions revisions
        WHERE revisions.answer_id=answers.answer_id AND revisions.attempt_id=attempts.attempt_id
          AND revisions.position=answers.position ORDER BY revision_no DESC LIMIT 1
      ) latest ON true
      WHERE attempts.worker_account_id=$1 AND cases.worker_account_id=$1 ORDER BY answers.committed_at,answers.answer_id`),
    assessmentAnswerRevisions: await rows(`SELECT revisions.answer_id,revisions.attempt_id,revisions.position,
      revisions.revision_no,revisions.text_value,revisions.boolean_value,revisions.numeric_value,revisions.revised_at
      FROM assessment_answer_revisions revisions JOIN assessment_attempts attempts USING(attempt_id)
      JOIN assessment_attempt_answers answers ON answers.answer_id=revisions.answer_id
        AND answers.attempt_id=attempts.attempt_id AND answers.position=revisions.position
      JOIN assurance_cases cases ON cases.case_id=attempts.case_id
      WHERE attempts.worker_account_id=$1 AND cases.worker_account_id=$1
      ORDER BY revisions.attempt_id,revisions.position,revisions.revision_no`),
    consentHistory: await rows(`SELECT consent_id,version,consent_type,purpose,case_id,action,withdrawal_rule,recorded_at
      FROM privacy_consent_records WHERE worker_id=$1 ORDER BY recorded_at,consent_id,version`),
    privacyRequests: await rows(`SELECT request_id,request_type,status,created_at,completed_at
      FROM privacy_requests WHERE worker_id=$1 ORDER BY created_at,request_id`),
    privacyReviews: await rows(`SELECT reviews.request_id,from_status,to_status,reason,reviewed_at
      FROM privacy_request_reviews reviews JOIN privacy_requests requests USING(request_id)
      WHERE requests.worker_id=$1 ORDER BY reviewed_at,review_sequence`),
    accommodations: await rows(`SELECT accommodation_id,accommodation_type,status,case_id,review_reason,
      reviewed_at,approved_adjustment,created_at FROM accessibility_accommodations WHERE worker_id=$1
      ORDER BY created_at,accommodation_id`),
    shareLinks: await rows(`SELECT links.share_link_id,links.fields,links.purpose,links.employer_detail,
      links.created_at,links.expires_at,links.revoked_at FROM scoped_share_links links
      JOIN auth_accounts accounts ON accounts.account_id=$1
      WHERE links.owner_worker_id=accounts.worker_reference OR EXISTS(
        SELECT 1 FROM worker_identity_worker_ids ids WHERE ids.worker_account_id=accounts.account_id
        AND ids.permanent_worker_id=links.owner_worker_id) ORDER BY links.created_at,links.share_link_id`)
  };
}
