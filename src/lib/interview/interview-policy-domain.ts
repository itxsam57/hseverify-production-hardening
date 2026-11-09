export const INTERVIEW_QUESTION_KINDS = ["MANDATORY", "RANDOM", "WEAK_AREA", "HIGH_RISK", "INTEGRITY", "FOLLOW_UP"] as const;
export type InterviewQuestionKind = (typeof INTERVIEW_QUESTION_KINDS)[number];
export type InterviewPolicyContext = Readonly<{
  tradeScope: string | null;
  qualificationScope: string | null;
  riskLevel: "STANDARD" | "HIGH" | "CRITICAL";
  language: string;
  jurisdiction: string;
}>;
export type InterviewQuestionSelectors = Readonly<{
  tradeScopes?: readonly string[];
  qualificationScopes?: readonly string[];
  riskLevels?: readonly string[];
  jurisdictions?: readonly string[];
  weakTopics?: readonly string[];
  requiresWrittenWeakness?: boolean;
  requiresIntegrity?: boolean;
  minimumAttempts?: number;
}>;
export type InterviewApprovedQuestion = Readonly<{
  templateId: string;
  kind: InterviewQuestionKind;
  topic: string;
  prompt: string;
  scoringGuidance?: string;
  selectors?: InterviewQuestionSelectors;
}>;
export type InterviewRecordingRule = Readonly<{
  policy: "VIDEO_AUDIO" | "AUDIO_ONLY" | "NOTES_ONLY" | "PROHIBITED";
  retentionDays: number;
  consentRequired: boolean;
}>;
export type InterviewPolicy = Readonly<{
  context?: Partial<InterviewPolicyContext>;
  questions: readonly InterviewApprovedQuestion[];
  randomQuestionCount?: number;
  scoringGuidance?: string;
  minimumActiveSeconds?: number;
  minimumTopics?: readonly string[];
  safetyCriteria?: readonly Readonly<{ criterionId: string; statement: string }>[];
  recording?: InterviewRecordingRule;
  recordingRules?: readonly (InterviewRecordingRule & { selectors: InterviewQuestionSelectors })[];
}>;
export type InterviewSelectionContext = InterviewPolicyContext & Readonly<{
  weakTopics: readonly string[];
  writtenWeakness: boolean;
  hasIntegrityFlags: boolean;
  previousAttemptCount: number;
}>;
export type InterviewSafetyFinding = Readonly<{
  criterionId: string;
  status: "NOT_OBSERVED" | "CONFIRMED";
  comments: string | null;
}>;
export type InterviewPolicyScorecard = Readonly<{
  questionSetId: string;
  questionSetVersion: number;
  coveredQuestionIds: readonly string[];
  safetyFindings: readonly InterviewSafetyFinding[];
  activeSeconds?: number;
}>;

export class InterviewPolicyInputError extends Error {
  constructor(message = "Interview policy input is invalid.") {
    super(message);
    this.name = "InterviewPolicyInputError";
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InterviewPolicyInputError(`Interview ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new InterviewPolicyInputError(`Interview ${label} contains an unsupported field.`);
  }
}
function text(value: unknown, label: string, max = 1000, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new InterviewPolicyInputError(`Interview ${label} is invalid.`);
  }
  return value.trim();
}
function identifier(value: unknown, label: string): string {
  const id = text(value, label, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new InterviewPolicyInputError(`Interview ${label} is invalid.`);
  return id;
}
function integer(value: unknown, label: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw new InterviewPolicyInputError(`Interview ${label} must be a whole number from zero to ${max}.`);
  }
  return value;
}
function strings(value: unknown, label: string, max = 100): readonly string[] {
  if (!Array.isArray(value) || value.length > max) throw new InterviewPolicyInputError(`Interview ${label} must be a list.`);
  const result = value.map(item => text(item, label, 120));
  if (new Set(result).size !== result.length) throw new InterviewPolicyInputError(`Interview ${label} contains duplicates.`);
  return Object.freeze(result);
}
function selectors(value: unknown): InterviewQuestionSelectors {
  const input = object(value, "selectors");
  const lists = ["tradeScopes", "qualificationScopes", "riskLevels", "jurisdictions", "weakTopics"] as const;
  keys(input, [...lists, "requiresWrittenWeakness", "requiresIntegrity", "minimumAttempts"], "selectors");
  const result: Record<string, unknown> = {};
  for (const key of lists) {
    if (input[key] !== undefined) {
      result[key] = strings(input[key], key);
      if ((result[key] as string[]).length === 0) throw new InterviewPolicyInputError("Interview selector lists cannot be empty.");
    }
  }
  if (result.riskLevels && (result.riskLevels as string[]).some(v => !["STANDARD", "HIGH", "CRITICAL"].includes(v))) {
    throw new InterviewPolicyInputError("Interview risk selector is invalid.");
  }
  for (const key of ["requiresWrittenWeakness", "requiresIntegrity"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") throw new InterviewPolicyInputError("Interview selector must be boolean.");
      result[key] = input[key];
    }
  }
  if (input.minimumAttempts !== undefined) result.minimumAttempts = integer(input.minimumAttempts, "minimum attempts", 1000);
  return Object.freeze(result) as InterviewQuestionSelectors;
}
function recording(value: unknown, withSelectors = false): InterviewRecordingRule & { selectors?: InterviewQuestionSelectors } {
  const input = object(value, "recording rule");
  keys(input, withSelectors ? ["policy", "retentionDays", "consentRequired", "selectors"] : ["policy", "retentionDays", "consentRequired"], "recording rule");
  if (!["VIDEO_AUDIO", "AUDIO_ONLY", "NOTES_ONLY", "PROHIBITED"].includes(String(input.policy))) {
    throw new InterviewPolicyInputError("Interview recording policy is invalid.");
  }
  const retentionDays = integer(input.retentionDays, "recording retention days", 3650);
  if (retentionDays < 1 || typeof input.consentRequired !== "boolean" ||
      (["NOTES_ONLY", "PROHIBITED"].includes(String(input.policy)) && input.consentRequired)) {
    throw new InterviewPolicyInputError("Interview recording retention or consent is invalid.");
  }
  return Object.freeze({
    policy: input.policy as InterviewRecordingRule["policy"],
    retentionDays,
    consentRequired: input.consentRequired,
    ...(withSelectors ? { selectors: selectors(input.selectors) } : {})
  });
}

export function normalizeInterviewPolicy(value: unknown): InterviewPolicy {
  const input = object(value, "configuration");
  keys(input, ["context", "questions", "randomQuestionCount", "scoringGuidance", "minimumActiveSeconds", "minimumTopics", "safetyCriteria", "recording", "recordingRules"], "configuration");
  let context: Partial<InterviewPolicyContext> | undefined;
  if (input.context !== undefined) {
    const raw = object(input.context, "context");
    keys(raw, ["tradeScope", "qualificationScope", "riskLevel", "language", "jurisdiction"], "context");
    const normalized: Record<string, unknown> = {};
    for (const key of ["tradeScope", "qualificationScope", "language", "jurisdiction"] as const) {
      if (raw[key] !== undefined) normalized[key] = raw[key] === null && ["tradeScope", "qualificationScope"].includes(key) ? null : text(raw[key], key, 120);
    }
    if (raw.riskLevel !== undefined) {
      if (!["STANDARD", "HIGH", "CRITICAL"].includes(String(raw.riskLevel))) throw new InterviewPolicyInputError("Interview risk level is invalid.");
      normalized.riskLevel = raw.riskLevel;
    }
    context = Object.freeze(normalized);
  }
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 100) {
    throw new InterviewPolicyInputError("Interview approved questions must contain 1–100 templates.");
  }
  const questions = input.questions.map(value => {
    const row = object(value, "question template");
    keys(row, ["templateId", "kind", "topic", "prompt", "scoringGuidance", "selectors"], "question template");
    if (!INTERVIEW_QUESTION_KINDS.includes(row.kind as InterviewQuestionKind)) throw new InterviewPolicyInputError("Interview question kind is invalid.");
    return Object.freeze({
      templateId: identifier(row.templateId, "template ID"),
      kind: row.kind as InterviewQuestionKind,
      topic: text(row.topic, "question topic", 120),
      prompt: text(row.prompt, "question prompt", 1000, 10),
      ...(row.scoringGuidance !== undefined ? { scoringGuidance: text(row.scoringGuidance, "scoring guidance", 4000) } : {}),
      ...(row.selectors !== undefined ? { selectors: selectors(row.selectors) } : {})
    });
  });
  if (new Set(questions.map(q => q.templateId)).size !== questions.length || !questions.some(q => q.kind === "MANDATORY")) {
    throw new InterviewPolicyInputError("Interview templates need unique IDs and a mandatory question.");
  }
  const randomQuestionCount = input.randomQuestionCount === undefined ? undefined : integer(input.randomQuestionCount, "random question count", 100);
  if ((randomQuestionCount ?? 0) > questions.filter(q => q.kind === "RANDOM").length) {
    throw new InterviewPolicyInputError("Interview random selection exceeds the approved pool.");
  }
  const minimumTopics = input.minimumTopics === undefined ? undefined : strings(input.minimumTopics, "minimum topics");
  if (minimumTopics?.some(topic => !questions.some(q => q.topic === topic))) {
    throw new InterviewPolicyInputError("Interview minimum topics must have approved question templates.");
  }
  let safetyCriteria: InterviewPolicy["safetyCriteria"];
  if (input.safetyCriteria !== undefined) {
    if (!Array.isArray(input.safetyCriteria) || input.safetyCriteria.length > 50) throw new InterviewPolicyInputError("Interview safety criteria must be a list.");
    safetyCriteria = Object.freeze(input.safetyCriteria.map(value => {
      const row = object(value, "safety criterion");
      keys(row, ["criterionId", "statement"], "safety criterion");
      return Object.freeze({ criterionId: identifier(row.criterionId, "safety criterion ID"), statement: text(row.statement, "automatic-fail safety statement", 2000, 10) });
    }));
    if (new Set(safetyCriteria.map(c => c.criterionId)).size !== safetyCriteria.length) throw new InterviewPolicyInputError("Interview safety criterion IDs must be unique.");
  }
  let recordingRules: InterviewPolicy["recordingRules"];
  if (input.recordingRules !== undefined) {
    if (!Array.isArray(input.recordingRules) || input.recordingRules.length > 50) throw new InterviewPolicyInputError("Interview recording rules must be a list.");
    recordingRules = Object.freeze(input.recordingRules.map(v => {
      const rule = recording(v, true) as InterviewRecordingRule & { selectors: InterviewQuestionSelectors };
      if (Object.keys(rule.selectors).some(key => !["tradeScopes","qualificationScopes","riskLevels","jurisdictions"].includes(key))) {
        throw new InterviewPolicyInputError("Interview recording selectors must use case context resolved before consent.");
      }
      return rule;
    }));
  }
  return Object.freeze({
    ...(context ? { context } : {}),
    questions: Object.freeze(questions),
    ...(randomQuestionCount !== undefined ? { randomQuestionCount } : {}),
    ...(input.scoringGuidance !== undefined ? { scoringGuidance: text(input.scoringGuidance, "scoring guidance", 4000) } : {}),
    ...(input.minimumActiveSeconds !== undefined ? { minimumActiveSeconds: integer(input.minimumActiveSeconds, "minimum active seconds", 86400) } : {}),
    ...(minimumTopics ? { minimumTopics } : {}),
    ...(safetyCriteria ? { safetyCriteria } : {}),
    ...(input.recording !== undefined ? { recording: recording(input.recording) } : {}),
    ...(recordingRules ? { recordingRules } : {})
  });
}

export function interviewSelectorsMatch(select: InterviewQuestionSelectors | undefined, context: InterviewSelectionContext): boolean {
  if (!select) return true;
  const matches = (required: string | null, allowed: readonly string[] | undefined) => !allowed || Boolean(required && allowed.some(v => v === "*" || v.toLowerCase() === required.toLowerCase()));
  return matches(context.tradeScope, select.tradeScopes) && matches(context.qualificationScope, select.qualificationScopes) &&
    matches(context.riskLevel, select.riskLevels) && matches(context.jurisdiction, select.jurisdictions) &&
    (!select.weakTopics || select.weakTopics.some(v => context.weakTopics.includes(v))) &&
    (select.requiresWrittenWeakness === undefined || select.requiresWrittenWeakness === context.writtenWeakness) &&
    (select.requiresIntegrity === undefined || select.requiresIntegrity === context.hasIntegrityFlags) &&
    (select.minimumAttempts === undefined || context.previousAttemptCount >= select.minimumAttempts);
}
export function eligibleInterviewQuestions(policy: InterviewPolicy, context: InterviewSelectionContext): readonly InterviewApprovedQuestion[] {
  return policy.questions.filter(q => interviewSelectorsMatch(q.selectors, context) &&
    (q.kind !== "HIGH_RISK" || ["HIGH", "CRITICAL"].includes(context.riskLevel)) &&
    (q.kind !== "WEAK_AREA" || context.weakTopics.includes(q.topic) || context.writtenWeakness) &&
    (q.kind !== "INTEGRITY" || context.hasIntegrityFlags));
}
export function resolveInterviewRecording(policy: InterviewPolicy, context: InterviewSelectionContext): InterviewRecordingRule | undefined {
  const matches = policy.recordingRules?.filter(rule => interviewSelectorsMatch(rule.selectors, context)) ?? [];
  if (matches.length > 1) throw new InterviewPolicyInputError("Interview recording rules are ambiguous for this case.");
  return matches[0] ?? policy.recording;
}

export function validateInterviewPolicyScorecard(
  value: unknown,
  reference: Readonly<{
    questionSetId: string; versionNo: number;
    questions: readonly Readonly<{ questionId: string; mandatory: boolean; topic: string | null }>[];
  }>,
  policy: InterviewPolicy,
  complete = false
): InterviewPolicyScorecard {
  const row = object(value, "scorecard");
  if (row.questionSetId !== reference.questionSetId || row.questionSetVersion !== reference.versionNo) {
    throw new InterviewPolicyInputError("Interview question set changed. Reload the frozen playbook before saving.");
  }
  const coveredQuestionIds = strings(row.coveredQuestionIds ?? [], "covered question IDs");
  const known = new Set(reference.questions.map(q => q.questionId));
  if (coveredQuestionIds.some(id => !known.has(id))) throw new InterviewPolicyInputError("Interview coverage contains a foreign question.");
  if (!Array.isArray(row.safetyFindings) || row.safetyFindings.length > 50) throw new InterviewPolicyInputError("Interview safety findings are invalid.");
  const criteria = new Set((policy.safetyCriteria ?? []).map(c => c.criterionId));
  const safetyFindings = row.safetyFindings.map(value => {
    const finding = object(value, "safety finding");
    if (typeof finding.criterionId !== "string" || !criteria.has(finding.criterionId) ||
        !["NOT_OBSERVED", "CONFIRMED"].includes(String(finding.status))) {
      throw new InterviewPolicyInputError("Interview safety finding must reference an approved criterion.");
    }
    const comments = finding.comments === null || finding.comments === undefined || finding.comments === "" ? null : text(finding.comments, "safety finding comments", 2000);
    if (finding.status === "CONFIRMED" && (!comments || comments.length < 10)) throw new InterviewPolicyInputError("Confirmed interview safety findings require explanatory comments.");
    return Object.freeze({ criterionId: finding.criterionId, status: finding.status as InterviewSafetyFinding["status"], comments });
  });
  if (new Set(safetyFindings.map(f => f.criterionId)).size !== safetyFindings.length) throw new InterviewPolicyInputError("Interview safety findings contain duplicates.");
  if (complete) {
    if (reference.questions.some(q => q.mandatory && !coveredQuestionIds.includes(q.questionId)) ||
        (policy.minimumTopics ?? []).some(topic => !reference.questions.some(q => q.topic === topic && coveredQuestionIds.includes(q.questionId)))) {
      throw new InterviewPolicyInputError("Interview coverage must include every mandatory question and required topic.");
    }
    if (safetyFindings.length !== criteria.size) throw new InterviewPolicyInputError("Review every automatic-fail interview safety criterion before End.");
  }
  return Object.freeze({
    questionSetId: reference.questionSetId, questionSetVersion: reference.versionNo,
    coveredQuestionIds: Object.freeze([...coveredQuestionIds].sort()),
    safetyFindings: Object.freeze(safetyFindings.sort((a, b) => a.criterionId.localeCompare(b.criterionId)))
  });
}


export function calculateInterviewActiveTime(
  events: readonly Readonly<{ event_type: string; occurred_at: string | Date }>[], now: Date
): Readonly<{ seconds: number; running: boolean }> {
  let activeStart: number | null = null, elapsedMs = 0;
  for (const event of events) {
    const time = new Date(event.occurred_at).getTime();
    if (["STARTED","RESUMED"].includes(event.event_type) && activeStart === null) activeStart = time;
    if (["PAUSED","TECHNICAL_ISSUE","ENDED","NO_SHOW"].includes(event.event_type) && activeStart !== null) {
      elapsedMs += Math.max(0,time-activeStart); activeStart = null;
    }
  }
  if (activeStart !== null) elapsedMs += Math.max(0,now.getTime()-activeStart);
  return Object.freeze({ seconds: Math.floor(elapsedMs/1000), running: activeStart !== null });
}
