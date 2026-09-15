import Link from "next/link";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";
import { scheduleInterviewAction } from "./actions";

export default async function AssessorInterviewsPage(): Promise<React.JSX.Element> {
  const actor = await requirePlatformPermission({ expectedRole: "assessor", permission: "interview.assigned.read" });
  const tenantId = actor.tenantMembership?.tenantId;
  if (!tenantId) throw new Error("Tenant context required.");
  const assignments = await new InterviewSchedulingService(await getDatabaseClient()).getAssessorAssignments({ tenantId, assessorAccountId: actor.accountId });

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Assessor Portal</p>
          <h1>Interview assignments</h1>
          <p className="page-intro">Assigned interview requests are isolated to this assessor account and tenant.</p>
        </div>
      </header>

      <section className="dashboard-section" aria-labelledby="interview-assignment-heading">
        <h2 id="interview-assignment-heading">Scheduled interviews</h2>
        {assignments.length === 0 ? <p>No interview assignments are currently available.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Case</th><th>Worker</th><th>Status</th><th>Schedule</th><th>Console</th></tr></thead>
              <tbody>{assignments.map((assignment) => (
                <tr key={assignment.interviewRequestId}>
                  <td>{assignment.caseId}</td>
                  <td>{assignment.workerAccountId}</td>
                  <td>{assignment.status}</td>
                  <td>{assignment.scheduledAt ?? (
                    <form action={scheduleInterviewAction}>
                      <input type="hidden" name="interviewRequestId" value={assignment.interviewRequestId} />
                      <input name="scheduledAt" type="datetime-local" required aria-label="Interview time" />
                      <button className="button button-secondary button-small" type="submit">Schedule</button>
                    </form>
                  )}</td>
                  <td><Link href={"/assessor/interviews/" + assignment.interviewRequestId}>Open interview console</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
