import { LiveInterviewMedia } from "@/components/interview/live-interview-media";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { createInterviewConsole, createInterviewSession } from "@/lib/interview/interview-scheduling-domain";
import { InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";
import {
  saveInterviewConsoleAction,
  submitInterviewConsoleAction
} from "../actions";

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
  const service = new InterviewSchedulingService(await getDatabaseClient());
  const request = await service.getAssignedInterview({
    assessorAccountId: actor.accountId,
    interviewRequestId
  });
  const saved = await service.loadLatestConsoleDraft({
    tenantId: request.tenantId,
    interviewRequestId: request.interviewRequestId
  });
  const newSession = createInterviewSession({
    interviewRequestId: request.interviewRequestId,
    caseId: request.caseId
  });
  const interviewSessionId = saved?.interviewSessionId ?? newSession.interviewSessionId;
  const session = { ...newSession, interviewSessionId };
  const initialConsole = createInterviewConsole({
    interviewSessionId,
    questionSetId: "interview_playbook_" + request.caseId
  });
  const consoleState = {
    ...initialConsole,
    notes: saved?.notes ?? initialConsole.notes,
    scorecard: saved?.scorecard ?? initialConsole.scorecard,
    recommendation: saved?.recommendation ?? initialConsole.recommendation,
    submitted: saved?.submitted ?? initialConsole.submitted
  };
  const locked = consoleState.submitted || request.status === "COMPLETED";

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Assessor Interview Console</p>
          <h1>Case {request.caseId}</h1>
          <p className="page-intro">
            Run the assigned competency interview with built-in encrypted live media,
            case evidence, notes and scoring in one workspace.
          </p>
        </div>
      </header>

      <section className="dashboard-section" aria-labelledby="media-heading">
        <h2 id="media-heading">Live interview media</h2>
        <p>Provider: Built-in WebRTC</p>
        <p>Recording policy: {consoleState.recordingPolicy.replaceAll("_", " ").toLowerCase()}</p>
        <LiveInterviewMedia
          interviewRequestId={request.interviewRequestId}
          role="assessor"
          enabled={Boolean(request.scheduledAt) && !locked && request.status !== "CANCELLED"}
        />
      </section>

      <section className="dashboard-section" aria-labelledby="case-heading">
        <h2 id="case-heading">Case context</h2>
        <p>Worker: {request.workerAccountId}</p>
        <p>Schedule: {request.scheduledAt ?? "Awaiting schedule"}</p>
        <p>Status: {request.status}</p>
        <p>Question set: {consoleState.questionSetId}</p>
      </section>

      <section className="dashboard-section" aria-labelledby="notes-heading">
        <h2 id="notes-heading">Notes and recommendation</h2>
        <p>Draft notes: {consoleState.notes.length}</p>
        <p>Recommendation: {consoleState.recommendation ?? "Not submitted"}</p>
        <p>{locked ? "Final interview record submitted and locked." : "Draft remains editable until final submission."}</p>
      </section>

      <section className="dashboard-section" aria-labelledby="capture-heading">
        <h2 id="capture-heading">Interview record</h2>
        <form action={saveInterviewConsoleAction}>
          <input type="hidden" name="interviewSessionId" value={session.interviewSessionId} />
          <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
          <label>
            Notes
            <textarea
              name="notes"
              defaultValue={consoleState.notes.at(-1)?.content ?? ""}
              disabled={locked}
            />
          </label>
          <label>
            Technical knowledge
            <input
              name="technicalKnowledge"
              type="number"
              min="0"
              max="5"
              required
              defaultValue={consoleState.scorecard.technicalKnowledge ?? ""}
              disabled={locked}
            />
          </label>
          <label>
            Safety awareness
            <input
              name="safetyAwareness"
              type="number"
              min="0"
              max="5"
              required
              defaultValue={consoleState.scorecard.safetyAwareness ?? ""}
              disabled={locked}
            />
          </label>
          <label>
            Comments
            <textarea
              name="comments"
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
              <option value="PASS">PASS</option>
              <option value="FAIL">FAIL</option>
            </select>
          </label>
          {!locked ? (
            <div className="button-row">
              <button type="submit">Save draft</button>
              <button type="submit" formAction={submitInterviewConsoleAction}>
                Submit final recommendation
              </button>
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}
