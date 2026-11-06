import Link from "next/link";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getEvidenceReviewService } from "@/lib/review/evidence-review-service";

export default async function ReviewerQueuePage({
  searchParams
}: {
  searchParams: Promise<{ q?: string | string[] }>
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.read"
  });
  const parameters = await searchParams;
  const query = typeof parameters.q === "string" ? parameters.q.trim().slice(0, 160) : "";
  const tasks = await (await getEvidenceReviewService()).listQueue(principal, query);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Verifier</p>
          <h1>Evidence review queue</h1>
          <p>Each task is pinned to one Worker and one exact evidence version.</p>
        </div>
      </div>
      <p>Showing {tasks.length} {query ? "matching " : ""}review {tasks.length === 1 ? "task" : "tasks"}</p>
      {tasks.length === 250 ? <p>Up to 250 review tasks are shown. Refine your search to find a specific task.</p> : null}
      {tasks.length === 0 ? (
        <div className="empty-state">
          <h2>No review tasks</h2>
          <p>{query ? "No review tasks match your search." : "Queued evidence will appear here."}</p>
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
                <th>Live eligibility</th>
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
                  <td>{task.eligibility?.eligible ? "Eligible" : task.eligibility?.reason.replaceAll("_", " ").toLowerCase()}</td>
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
