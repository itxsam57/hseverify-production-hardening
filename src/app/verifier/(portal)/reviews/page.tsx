import Link from "next/link";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getEvidenceReviewService } from "@/lib/review/evidence-review-service";

export default async function ReviewerQueuePage(): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.read"
  });
  const tasks = await (await getEvidenceReviewService()).listQueue(principal);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Verifier</p>
          <h1>Evidence review queue</h1>
          <p>Each task is pinned to one Worker and one exact evidence version.</p>
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="empty-state">
          <h2>No review tasks</h2>
          <p>Queued evidence will appear here.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Worker</th>
                <th>Scope</th>
                <th>Evidence</th>
                <th>Version</th>
                <th>Attachment</th>
                <th>Status</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.taskId}>
                  <td>{task.workerAccountId}</td>
                  <td>
                    {task.caseId ? (
                      <>Assurance Case <code>{task.caseId}</code></>
                    ) : (
                      "Independent Worker review"
                    )}
                  </td>
                  <td>{task.evidenceKind}</td>
                  <td>{task.sourceVersionId}</td>
                  <td>{task.secureFileId ? "File attached" : "Structured evidence only"}</td>
                  <td>{task.taskStatus}</td>
                  <td><Link href={`/verifier/reviews/${task.taskId}`}>Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
