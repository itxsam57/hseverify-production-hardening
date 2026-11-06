import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseClient } from "@/lib/database/database";
import {
  eligibleInterviewQuestions, normalizeInterviewPolicy, resolveInterviewRecording,
  InterviewPolicyInputError,
  type InterviewApprovedQuestion, type InterviewPolicy, type InterviewPolicyContext, type InterviewSelectionContext
} from "./interview-policy-domain";

export type PinnedInterviewPolicy = Readonly<{
  snapshotId: string | null;
  policyVersionId: string | null;
  policy: InterviewPolicy | null;
}>;
function parsed(value: unknown): Record<string, unknown> {
  const raw = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InterviewPolicyInputError("Interview pinned policy is unreadable.");
  return raw as Record<string, unknown>;
}
export async function loadPinnedInterviewPolicy(database: DatabaseClient, tenantId: string, caseId: string): Promise<PinnedInterviewPolicy> {
  const rows = await database.query<{ snapshot_id: string; global_policy_version_id: string; effective_value_json: unknown }>(
    `SELECT snapshots.snapshot_id,snapshots.global_policy_version_id,snapshots.effective_value_json
       FROM assurance_case_policy_snapshots snapshots
       JOIN assurance_cases cases ON cases.case_id=snapshots.case_id AND cases.tenant_id=snapshots.tenant_id
      WHERE snapshots.tenant_id=$1 AND snapshots.case_id=$2`, [tenantId, caseId]);
  const row = rows.rows[0];
  if (!row) return Object.freeze({ snapshotId: null, policyVersionId: null, policy: null });
  const values = parsed(row.effective_value_json);
  return Object.freeze({
    snapshotId: row.snapshot_id, policyVersionId: row.global_policy_version_id,
    policy: values.interview === undefined ? null : normalizeInterviewPolicy(values.interview)
  });
}
export function interviewPolicyContext(policy: InterviewPolicy): InterviewPolicyContext {
  return Object.freeze({
    tradeScope: policy.context?.tradeScope ?? null,
    qualificationScope: policy.context?.qualificationScope ?? null,
    riskLevel: policy.context?.riskLevel ?? "STANDARD",
    language: policy.context?.language ?? "English",
    jurisdiction: policy.context?.jurisdiction ?? "GLOBAL"
  });
}
export function selectApprovedInterviewQuestions(policy: InterviewPolicy, context: InterviewSelectionContext, requestId: string, snapshotId: string): readonly InterviewApprovedQuestion[] {
  const eligible = eligibleInterviewQuestions(policy, context);
  const random = eligible.filter(q => q.kind === "RANDOM").map(q => ({
    question: q, rank: createHash("sha256").update(requestId + "\u0000" + snapshotId + "\u0000" + q.templateId).digest("hex")
  })).sort((a, b) => a.rank.localeCompare(b.rank));
  const count = policy.randomQuestionCount ?? 0;
  if (random.length < count || !eligible.some(q => q.kind === "MANDATORY")) throw new InterviewPolicyInputError("Interview approved question pool is insufficient for this case.");
  return Object.freeze([
    ...eligible.filter(q => !["RANDOM", "FOLLOW_UP"].includes(q.kind)),
    ...random.slice(0, count).map(row => row.question)
  ]);
}
export async function interviewRequestPolicyValues(database: DatabaseClient, tenantId: string, caseId: string) {
  const pinned = await loadPinnedInterviewPolicy(database, tenantId, caseId);
  if (!pinned.policy) return null;
  const context = interviewPolicyContext(pinned.policy);
  const recording = resolveInterviewRecording(pinned.policy, {
    ...context, weakTopics: [], writtenWeakness: false, hasIntegrityFlags: false, previousAttemptCount: 0
  });
  return Object.freeze({ context, recording });
}
