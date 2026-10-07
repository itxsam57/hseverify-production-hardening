import { notFound } from "next/navigation";

import { LiveInterviewMedia } from "@/components/interview/live-interview-media";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { getInterviewPlaybookService } from "@/lib/interview/interview-playbook-service";
import { InterviewRuntimeService } from "@/lib/interview/interview-runtime-service";
import { createInterviewConsole, createInterviewSession } from "@/lib/interview/interview-scheduling-domain";
import { InterviewAssignmentAccessError, InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";
import { CaseAccommodationService } from "@/lib/privacy/case-accommodation-service";
import {
  addInterviewFollowUpAction,
  admitInterviewAction,
  claimInterviewAction,
  endInterviewAction,
  markInterviewNoShowAction,
  pauseInterviewAction,
  reportAssessorInterviewTechnicalIssueAction,
  resumeInterviewAction,
  saveInterviewConsoleAction,
  startInterviewAction,
  submitInterviewConsoleAction
} from "../actions";

function ScoreField({
  name,
  label,
  defaultValue,
  disabled
}: {
  name: string;
  label: string;
  defaultValue: number | null | undefined;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <label>
      {label}
      <input
        name={name}
        type="number"
        min="0"
        max="5"
        step="1"
        required
        defaultValue={defaultValue ?? ""}
        disabled={disabled}
      />
    </label>
  );
}

export default async function AssessorInterviewConsolePage({
  params
}: {
  params: Promise<{ interviewRequestId: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requirePlatformPermission({
    expectedRole: "assessor",
    permission: "interview.assigned.read"
  });
  const { interviewRequestId } = await params;
  const database = await getDatabaseClient();
  const scheduling = new InterviewSchedulingService(database);
  const request = await scheduling.getAssignedInterview({
    assessorAccountId: actor.accountId,
    interviewRequestId
  }).catch((error: unknown) => {
    if (error instanceof InterviewAssignmentAccessError) notFound();
    throw error;
  });
  const runtimeService = new InterviewRuntimeService(Promise.resolve(database));
  const [runtime, saved, playbook, accommodation] = await Promise.all([
    runtimeService.view(actor, interviewRequestId),
    scheduling.loadLatestConsoleDraft({
      tenantId: request.tenantId,
      interviewRequestId: request.interviewRequestId
    }),
    getInterviewPlaybookService().getAssigned(actor, interviewRequestId),
    new CaseAccommodationService(Promise.resolve(database)).resolveForWorker(
      request.caseId,
      request.workerAccountId
    )
  ]);

  const newSession = createInterviewSession({
    interviewRequestId: request.interviewRequestId,
    caseId: request.caseId
  });
  const interviewSessionId =
    runtime.interviewSessionId ??
    saved?.interviewSessionId ??
    newSession.interviewSessionId;
  const initialConsole = createInterviewConsole({
    interviewSessionId,
    questionSetId: playbook?.questionSetId ?? "interview_playbook_pending_claim"
  });
  const consoleState = {
    ...initialConsole,
    notes: saved?.notes ?? initialConsole.notes,
    scorecard: {
      ...initialConsole.scorecard,
      ...(saved?.scorecard ?? {})
    },
    recommendation: saved?.recommendation ?? initialConsole.recommendation,
    submitted: saved?.submitted ?? initialConsole.submitted
  };

  const locked = consoleState.submitted || request.status === "COMPLETED";
  const runtimeClosed = runtime.status === "ENDED" || runtime.status === "NO_SHOW";
  const mediaEnabled =
    runtime.status === "ADMITTED" ||
    runtime.status === "ACTIVE" ||
    runtime.status === "PAUSED" ||
    runtime.status === "TECHNICAL_HOLD";
  const canClaim =
    !locked &&
    (runtime.status === null ||
      runtime.status === "WAITING_ROOM" ||
      (runtime.status === "READY" && !runtime.claimedAt));
  const canAdmit = !locked && runtime.status === "READY" && Boolean(runtime.claimedAt);
  const canStart = !locked && runtime.status === "ADMITTED";
  const canPause = !locked && runtime.status === "ACTIVE";
  const canResume =
    !locked && (runtime.status === "PAUSED" || runtime.status === "TECHNICAL_HOLD");
  const canEnd =
    !locked &&
    (runtime.status === "ACTIVE" ||
      runtime.status === "PAUSED" ||
      runtime.status === "TECHNICAL_HOLD");

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Assessor Interview Console</p>
          <h1>Case {request.caseId}</h1>
          <p className="page-intro">
            Run the assigned structured competency interview through one replayable runtime:
            waiting room, playbook, live media, recording policy, notes, scorecard and final recommendation.
          </p>
        </div>
        <span className="status-pill">
          {(runtime.status ?? request.status).replaceAll("_", " ")}
        </span>
      </header>

      <section className="dashboard-section" aria-labelledby="runtime-heading">
        <h2 id="runtime-heading">Interview runtime</h2>
        <dl className="compact-definition-list">
          <div><dt>Worker</dt><dd>{request.workerAccountId}</dd></div>
          <div><dt>Scheduled</dt><dd>{request.scheduledAt ?? "Awaiting schedule"}</dd></div>
          <div><dt>Request status</dt><dd>{request.status}</dd></div>
          <div><dt>Runtime state</dt><dd>{runtime.status ?? "Not opened"}</dd></div>
          <div><dt>Worker ready</dt><dd>{runtime.workerReadyAt ?? "Not ready"}</dd></div>
          <div><dt>Recording policy</dt><dd>{runtime.recordingPolicy.replaceAll("_", " ")}</dd></div>
          <div><dt>Recording consent</dt><dd>{runtime.recordingConsentRequired ? runtime.recordingConsentedAt ?? "Required — not recorded" : "Not required"}</dd></div>
          <div><dt>Approved time allowance</dt><dd>{accommodation.adjustment.timeMultiplier}×</dd></div>
          <div><dt>Extra break allowance</dt><dd>{accommodation.adjustment.extraBreakMinutes} minutes</dd></div>
          <div><dt>Captions</dt><dd>{accommodation.adjustment.captions ? "Approved" : "Standard delivery"}</dd></div>
          <div><dt>Interpreter</dt><dd>{accommodation.adjustment.interpreter ? "Approved" : "Standard delivery"}</dd></div>
          <div><dt>Session</dt><dd><code>{interviewSessionId}</code></dd></div>
        </dl>

        <div className="button-row">
          {canClaim ? (
            <form action={claimInterviewAction}>
              <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
              <button className="button button-primary" type="submit">Claim interview</button>
            </form>
          ) : null}
          {canAdmit ? (
            <form action={admitInterviewAction}>
              <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
              <button className="button button-primary" type="submit">Admit ready Worker</button>
            </form>
          ) : null}
          {canStart ? (
            <form action={startInterviewAction}>
              <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
              <button className="button button-primary" type="submit">Start interview</button>
            </form>
          ) : null}
          {canResume ? (
            <form action={resumeInterviewAction}>
              <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
              <button className="button button-primary" type="submit">Resume interview</button>
            </form>
          ) : null}
          {canEnd ? (
            <form action={endInterviewAction}>
              <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
              <button className="button button-danger" type="submit">End interview</button>
            </form>
          ) : null}
        </div>

        {canPause ? (
          <form action={pauseInterviewAction} className="form-grid">
            <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
            <label>
              Pause reason
              <input name="pauseReason" minLength={5} maxLength={2000} required />
            </label>
            <button className="button button-secondary" type="submit">Pause interview</button>
          </form>
        ) : null}

        {!runtimeClosed && !locked ? (
          <div className="two-column-grid">
            <form action={reportAssessorInterviewTechnicalIssueAction} className="form-grid">
              <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
              <label>
                Technical issue
                <textarea name="issue" rows={3} minLength={5} maxLength={2000} required />
              </label>
              <button className="button button-secondary" type="submit">Put on technical hold</button>
            </form>
            <form action={markInterviewNoShowAction}>
              <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
              <button className="button button-secondary" type="submit">
                Mark Worker no-show
              </button>
              <p className="muted-copy">Available only after the controlled no-show time threshold.</p>
            </form>
          </div>
        ) : null}
      </section>

      <section className="dashboard-section" aria-labelledby="media-heading">
        <h2 id="media-heading">Live interview media</h2>
        <p>Provider: Built-in WebRTC</p>
        <LiveInterviewMedia
          interviewRequestId={request.interviewRequestId}
          role="assessor"
          enabled={mediaEnabled && !locked}
          recordingPolicy={runtime.recordingPolicy}
          recordingEnabled={runtime.status === "ACTIVE"}
          recordingRetentionDays={runtime.recordingRetentionDays}
        />
      </section>

      <section className="dashboard-section" aria-labelledby="playbook-heading">
        <h2 id="playbook-heading">Structured interview playbook</h2>
        {!playbook ? (
          <p className="muted-copy">
            Claim the interview to freeze the candidate-specific playbook for this session.
          </p>
        ) : (
          <div className="content-stack">
            <p>
              Question set <code>{playbook.questionSetId}</code> · version {playbook.versionNo}
            </p>
            <ol>
              {playbook.questions.map((question) => (
                <li key={question.questionId}>
                  <strong>{question.kind.replaceAll("_", " ")}</strong>
                  {question.topic ? " · " + question.topic : ""}
                  <p>{question.prompt}</p>
                  <p className="muted-copy">Source: {question.source}</p>
                </li>
              ))}
            </ol>
            {!locked ? (
              <form action={addInterviewFollowUpAction} className="form-grid">
                <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
                <label>
                  Assessor follow-up question
                  <textarea name="prompt" rows={3} minLength={10} maxLength={1000} required />
                </label>
                <button className="button button-secondary" type="submit">
                  Add versioned follow-up
                </button>
              </form>
            ) : null}
          </div>
        )}
      </section>

      <section className="dashboard-section" aria-labelledby="capture-heading">
        <h2 id="capture-heading">Notes, scorecard and recommendation</h2>
        <p className="muted-copy">
          Scores are 0–5. Every dimension must be saved before End. The final recommendation
          can be submitted only after the runtime is formally Ended.
        </p>
        <form key={JSON.stringify(saved ?? { interviewSessionId })} action={saveInterviewConsoleAction} className="form-grid">
          <input type="hidden" name="interviewSessionId" value={interviewSessionId} />
          <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
          <label>
            Notes
            <textarea
              name="notes"
              rows={6}
              defaultValue={consoleState.notes.at(-1)?.content ?? ""}
              disabled={locked}
            />
          </label>

          <ScoreField name="technicalKnowledge" label="Technical knowledge" defaultValue={consoleState.scorecard.technicalKnowledge} disabled={locked} />
          <ScoreField name="practicalReasoning" label="Practical reasoning" defaultValue={consoleState.scorecard.practicalReasoning} disabled={locked} />
          <ScoreField name="safetyAwareness" label="Safety awareness" defaultValue={consoleState.scorecard.safetyAwareness} disabled={locked} />
          <ScoreField name="communication" label="Communication" defaultValue={consoleState.scorecard.communication} disabled={locked} />
          <ScoreField name="consistencyWithWrittenAnswers" label="Consistency with written answers" defaultValue={consoleState.scorecard.consistencyWithWrittenAnswers} disabled={locked} />
          <ScoreField name="confidenceClarity" label="Confidence / clarity" defaultValue={consoleState.scorecard.confidenceClarity} disabled={locked} />
          <ScoreField name="tradeJudgment" label="Trade judgment" defaultValue={consoleState.scorecard.tradeJudgment} disabled={locked} />

          <label>
            Scorecard comments
            <textarea
              name="comments"
              rows={4}
              defaultValue={consoleState.scorecard.comments ?? ""}
              disabled={locked}
            />
          </label>
          <label>
            Recommendation
            <select
              name="recommendation"
              defaultValue={consoleState.recommendation ?? ""}
              disabled={locked}
              required
            >
              <option value="">Pending</option>
              <option value="PASS">Pass</option>
              <option value="CONDITIONAL_PASS">Conditional Pass</option>
              <option value="ADDITIONAL_EVIDENCE_REQUIRED">Additional Evidence Required</option>
              <option value="REASSESSMENT_REQUIRED">Reassessment Required</option>
              <option value="SECOND_INTERVIEW_REQUIRED">Second Interview Required</option>
              <option value="FAIL">Fail</option>
            </select>
          </label>

          {!locked ? (
            <div className="button-row">
              <button
                className="button button-secondary"
                type="submit"
                name="intent"
                value="save"
              >
                Save draft
              </button>
              <button
                className="button button-primary"
                type="submit"
                formAction={submitInterviewConsoleAction}
                disabled={runtime.status !== "ENDED"}
              >
                Submit final recommendation
              </button>
            </div>
          ) : (
            <p className="status-banner status-success">
              Final interview record submitted and locked.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
