import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { createInterviewConsole, createInterviewSession } from "@/lib/interview/interview-scheduling-domain";
import { InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";
import { saveInterviewConsoleAction } from "../actions";

export default async function AssessorInterviewConsolePage({ params }: { params: Promise<{ interviewRequestId: string }> }): Promise<React.JSX.Element> {
  const actor = await requirePlatformPermission({ expectedRole: "assessor", permission: "interview.assigned.read" });
  const tenantId = actor.tenantMembership?.tenantId;
  if (!tenantId) throw new Error("Tenant context required.");
  const { interviewRequestId } = await params;
  const request = await new InterviewSchedulingService(await getDatabaseClient()).getAssignedInterview({ tenantId, assessorAccountId: actor.accountId, interviewRequestId });
  const session = createInterviewSession({ interviewRequestId: request.interviewRequestId, caseId: request.caseId });
  const consoleState = createInterviewConsole({ interviewSessionId: session.interviewSessionId, questionSetId: "interview_playbook_" + request.caseId });

  return (
    <div className="dashboard-page">
      <header className="page-heading-row"><div><p className="eyebrow">Assessor Interview Console</p><h1>Case {request.caseId}</h1><p className="page-intro">The local adapter keeps the production media boundary explicit while provider activation remains external.</p></div></header>
      <section className="dashboard-section" aria-labelledby="media-heading"><h2 id="media-heading">Live media boundary</h2><p>Provider: {session.mediaProvider}</p><p>Connection: {consoleState.connectionState}</p><p>Recording enabled: {session.recordingAllowed ? "Yes" : "No"}</p></section>
      <section className="dashboard-section" aria-labelledby="case-heading"><h2 id="case-heading">Case context</h2><p>Worker: {request.workerAccountId}</p><p>Schedule: {request.scheduledAt ?? "Awaiting schedule"}</p><p>Question set: {consoleState.questionSetId}</p></section>
      <section className="dashboard-section" aria-labelledby="notes-heading"><h2 id="notes-heading">Notes and recommendation</h2><p>Draft notes: {consoleState.notes.length}</p><p>Recommendation: {consoleState.recommendation ?? "Not submitted"}</p></section>
      <section className="dashboard-section" aria-labelledby="capture-heading">
        <h2 id="capture-heading">Interview record</h2>
        <form action={saveInterviewConsoleAction}>
          <input type="hidden" name="interviewSessionId" value={session.interviewSessionId} />
          <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
          <label>Notes<textarea name="notes" /></label>
          <label>Technical knowledge<input name="technicalKnowledge" type="number" min="0" max="5" /></label>
          <label>Safety awareness<input name="safetyAwareness" type="number" min="0" max="5" /></label>
          <label>Comments<textarea name="comments" /></label>
          <label>Recommendation<select name="recommendation"><option value="">Pending</option><option value="PASS">PASS</option><option value="FAIL">FAIL</option></select></label>
          <button type="submit">Save interview record</button>
        </form>
      </section>
    </div>
  );
}
