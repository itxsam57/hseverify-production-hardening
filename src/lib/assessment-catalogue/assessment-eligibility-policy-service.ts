import "server-only";
import type { DatabaseClient } from "../database/database";
import { normalizeAssessmentEligibilityPolicyFields, type AssessmentEligibilityRequirements } from "../policy/assessment-eligibility-policy-domain";

export type AssessmentEligibilityDecision = Readonly<{
  eligibilityStatus: "AVAILABLE" | "WAITING" | "ATTEMPT_LIMIT" | "QUESTION_CAPACITY" | "QUALIFICATION_REQUIRED" | "EXPERIENCE_REQUIRED" | "JURISDICTION_REQUIRED" | "TRADE_REQUIRED";
  eligibilityReason: string | null;
  availableAt: string | null;
}>;

const AVAILABLE: AssessmentEligibilityDecision = Object.freeze({
  eligibilityStatus: "AVAILABLE", eligibilityReason: null, availableAt: null
});


function blocked(
  eligibilityStatus: "QUALIFICATION_REQUIRED" | "EXPERIENCE_REQUIRED" | "JURISDICTION_REQUIRED" | "TRADE_REQUIRED",
  eligibilityReason: string
): AssessmentEligibilityDecision {
  return Object.freeze({eligibilityStatus, eligibilityReason, availableAt: null});
}

function matchesLabel(labels: readonly string[] | undefined, value: string | null): boolean {
  return labels === undefined || (value !== null &&
    labels.some(label => label.toLowerCase() === value.trim().toLowerCase()));
}

// Union overlaps before counting whole calendar months; concurrent jobs cannot inflate experience.
function verifiedExperienceMonths(rows: readonly {start_date: string | Date; end_date: string | Date | null}[], now: Date): number {
  const ceiling = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const intervals = rows.map(row => ({
    start: new Date(row.start_date).getTime(),
    end: Math.min(row.end_date ? new Date(row.end_date).getTime() : ceiling, ceiling)
  })).filter(row => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end >= row.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: {start: number; end: number}[] = [];
  for (const interval of intervals) {
    const prior = merged[merged.length - 1];
    if (prior && interval.start <= prior.end) prior.end = Math.max(prior.end, interval.end);
    else merged.push({...interval});
  }
  return merged.reduce((total, interval) => {
    const start = new Date(interval.start), end = new Date(interval.end);
    const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      end.getUTCMonth() - start.getUTCMonth() - (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
    return total + Math.max(0, months);
  }, 0);
}

async function evaluateVerifiedContext(
  database: DatabaseClient,
  workerAccountId: string,
  requirements: AssessmentEligibilityRequirements,
  now: Date
): Promise<AssessmentEligibilityDecision> {
  if (requirements.qualificationCategories || requirements.qualificationTitles) {
    const qualified = await database.query<{category: string | null; qualification_title: string | null}>(
      `SELECT DISTINCT qualifications.category, qualifications.qualification_title
       FROM worker_evidence_records AS records
       JOIN worker_evidence_versions AS versions
         ON versions.version_id=records.current_version_id AND versions.record_id=records.record_id
        AND versions.version_status='submitted'
       JOIN worker_qualification_versions AS qualifications ON qualifications.version_id=versions.version_id
       JOIN evidence_review_tasks AS tasks
         ON tasks.source_record_id=records.record_id AND tasks.source_version_id=versions.version_id
        AND tasks.worker_account_id=records.worker_account_id AND tasks.evidence_kind='qualification'
        AND tasks.task_status='APPROVED'
       JOIN evidence_review_decisions AS decisions
         ON decisions.task_id=tasks.task_id AND decisions.source_version_id=versions.version_id
        AND decisions.verifier_account_id=tasks.assigned_verifier_account_id AND decisions.outcome='APPROVED'
       WHERE records.worker_account_id=$1 AND records.record_kind='qualification'
         AND records.lifecycle_status='active'
         AND (qualifications.issue_date IS NULL OR qualifications.issue_date <= $2::date)
         AND (qualifications.expiry_date IS NULL OR qualifications.expiry_date >= $2::date)`,
      [workerAccountId, now.toISOString().slice(0, 10)]
    );
    if (!qualified.rows.some(row => matchesLabel(requirements.qualificationCategories, row.category) &&
        matchesLabel(requirements.qualificationTitles, row.qualification_title))) {
      return blocked("QUALIFICATION_REQUIRED", "A current verified qualification matching the published framework requirements is required.");
    }
  }
  if (requirements.experienceRoleTitles || requirements.minimumExperienceMonths !== undefined) {
    const experiences = await database.query<{role_title: string | null; start_date: string | Date; end_date: string | Date | null}>(
      `SELECT DISTINCT records.record_id, experience.role_title, experience.start_date, experience.end_date
       FROM worker_evidence_records AS records
       JOIN worker_evidence_versions AS versions
         ON versions.version_id=records.current_version_id AND versions.record_id=records.record_id
        AND versions.version_status='submitted'
       JOIN worker_experience_versions AS experience ON experience.version_id=versions.version_id
       JOIN evidence_review_tasks AS tasks
         ON tasks.source_record_id=records.record_id AND tasks.source_version_id=versions.version_id
        AND tasks.worker_account_id=records.worker_account_id AND tasks.evidence_kind='experience'
        AND tasks.task_status='APPROVED'
       JOIN evidence_review_decisions AS decisions
         ON decisions.task_id=tasks.task_id AND decisions.source_version_id=versions.version_id
        AND decisions.verifier_account_id=tasks.assigned_verifier_account_id AND decisions.outcome='APPROVED'
       WHERE records.worker_account_id=$1 AND records.record_kind='experience'
         AND records.lifecycle_status IN ('active','ended') AND experience.start_date IS NOT NULL
         AND experience.start_date <= $2::date`,
      [workerAccountId, now.toISOString().slice(0, 10)]
    );
    const matched = experiences.rows.filter(row => matchesLabel(requirements.experienceRoleTitles, row.role_title));
    if (!matched.length || verifiedExperienceMonths(matched, now) < (requirements.minimumExperienceMonths ?? 0)) {
      return blocked("EXPERIENCE_REQUIRED", "Verified experience matching the published framework roles and calendar month requirement is required.");
    }
  }
  if (requirements.verifiedTrades) {
    const trades = await database.query<{verified_trade: string}>(
      `SELECT decisions.verified_trade
       FROM worker_evidence_records AS records
       JOIN worker_evidence_versions AS versions
         ON versions.version_id=records.current_version_id AND versions.record_id=records.record_id
        AND versions.version_status='submitted'
       JOIN worker_skill_versions AS skills ON skills.version_id=versions.version_id
       JOIN evidence_review_tasks AS tasks
         ON tasks.source_record_id=records.record_id AND tasks.source_version_id=versions.version_id
        AND tasks.worker_account_id=records.worker_account_id AND tasks.evidence_kind='skill'
        AND tasks.task_status='APPROVED'
       JOIN evidence_review_decisions AS decisions
         ON decisions.task_id=tasks.task_id AND decisions.source_version_id=versions.version_id
        AND decisions.verifier_account_id=tasks.assigned_verifier_account_id AND decisions.outcome='APPROVED'
        AND decisions.verification_method='evidence_review' AND decisions.verified_trade=skills.related_trade
       JOIN worker_evidence_attachments AS attachments
         ON attachments.record_id=records.record_id AND attachments.version_id=versions.version_id
        AND attachments.secure_file_id=decisions.verification_source_file_id AND attachments.superseded_at IS NULL
       JOIN platform_secure_files AS files
         ON files.file_id=attachments.secure_file_id AND files.owner_account_id=records.worker_account_id
        AND files.owner_role='worker' AND files.lifecycle_status='available'
       WHERE records.worker_account_id=$1 AND records.record_kind='skill' AND records.lifecycle_status='active'
         AND decisions.verifier_account_id<>records.worker_account_id`,
      [workerAccountId]
    );
    if (!trades.rows.some(row => matchesLabel(requirements.verifiedTrades, row.verified_trade))) {
      return blocked("TRADE_REQUIRED", "A current explicitly verified trade mapping matching the published framework requirements is required.");
    }
  }
  if (requirements.countriesOfResidence) {
    const identity = await database.query<{country_of_residence: string | null}>(
      `SELECT details.country_of_residence
       FROM worker_identities AS identities
       JOIN worker_identity_versions AS versions
         ON versions.identity_id=identities.identity_id AND versions.version_number=identities.current_version_number
        AND versions.version_status='submitted'
       JOIN worker_identity_version_drafts AS details ON details.identity_version_id=versions.identity_version_id
       WHERE identities.worker_account_id=$1 AND identities.lifecycle_status IN ('verified','reinstated')
       LIMIT 1`, [workerAccountId]
    );
    if (!identity.rows[0]?.country_of_residence) {
      return blocked("JURISDICTION_REQUIRED", "Verified identity residence is missing for the published jurisdiction requirement.");
    }
    if (!matchesLabel(requirements.countriesOfResidence, identity.rows[0].country_of_residence)) {
      return blocked("JURISDICTION_REQUIRED", "The verified identity residence does not meet the published jurisdiction requirement.");
    }
  }
  return AVAILABLE;
}

export async function evaluateWorkerAssessmentHistory(
  database: DatabaseClient,
  input: {
    workerAccountId: string;
    frameworkId: string;
    policyValues: Readonly<Record<string, unknown>>;
    excludeCaseId?: string;
    now: Date;
    lockWorker?: boolean;
  }
): Promise<AssessmentEligibilityDecision> {
  const policy = normalizeAssessmentEligibilityPolicyFields(input.policyValues);
  if (policy.assessmentWaitingPeriodDays === undefined && policy.assessmentAttemptLimit === undefined && policy.assessmentEligibility === undefined) {
    return AVAILABLE;
  }
  // Mutation transactions serialize the Worker/framework decision with concurrent starts.
  if (input.lockWorker) {
    await database.query("SELECT account_id FROM auth_accounts WHERE account_id=$1 FOR UPDATE", [input.workerAccountId]);
  }
  if (policy.assessmentEligibility) {
    const context = await evaluateVerifiedContext(database, input.workerAccountId, policy.assessmentEligibility, input.now);
    if (context.eligibilityStatus !== "AVAILABLE") return context;
  }
  if (policy.assessmentWaitingPeriodDays === undefined && policy.assessmentAttemptLimit === undefined) return AVAILABLE;
  const history = await database.query<{attempt_count: number | string; last_terminal_at: string | Date | null}>(
    `SELECT COUNT(DISTINCT attempts.case_id)::int AS attempt_count,
       MAX(COALESCE(attempts.submitted_at, attempts.updated_at))
         FILTER (WHERE attempts.status IN ('SUBMITTED','AUTO_SUBMITTED','INVALIDATED')) AS last_terminal_at
     FROM assessment_attempts AS attempts
     JOIN assessment_blueprint_versions AS versions
       ON versions.blueprint_version_id=attempts.blueprint_version_id
     WHERE attempts.worker_account_id=$1
       AND versions.framework_id=$2
       AND ($3::text IS NULL OR attempts.case_id<>$3)`,
    [input.workerAccountId, input.frameworkId, input.excludeCaseId ?? null]
  );
  const row = history.rows[0], count = Number(row?.attempt_count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Assessment attempt history is invalid.");
  if (policy.assessmentAttemptLimit !== undefined && count >= policy.assessmentAttemptLimit) {
    return Object.freeze({
      eligibilityStatus: "ATTEMPT_LIMIT",
      eligibilityReason: "The published assessment attempt limit has been reached for this framework.",
      availableAt: null
    });
  }
  if (policy.assessmentWaitingPeriodDays !== undefined && row?.last_terminal_at) {
    const terminal = new Date(row.last_terminal_at).getTime();
    const availableAt = new Date(terminal + policy.assessmentWaitingPeriodDays * 86_400_000);
    if (!Number.isFinite(availableAt.getTime())) throw new Error("Assessment waiting-period date is invalid.");
    if (input.now.getTime() < availableAt.getTime()) {
      return Object.freeze({
        eligibilityStatus: "WAITING",
        eligibilityReason: "The published assessment waiting period ends at " + availableAt.toISOString() + ".",
        availableAt: availableAt.toISOString()
      });
    }
  }
  return AVAILABLE;
}
