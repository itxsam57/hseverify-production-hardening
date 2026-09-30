import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { CaseReplayService } from "@/lib/audit/case-replay-service";

export const dynamic = "force-dynamic";

export default async function AdminCaseReplayPage({
  searchParams
}: {
  searchParams: Promise<{ caseId?: string; purpose?: string }>;
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.security.read"
  });
  const params = await searchParams;
  const caseId = params.caseId?.trim() ?? "";
  const purpose = params.purpose?.trim() ?? "";
  const replay = caseId && purpose
    ? await new CaseReplayService().replay(principal, caseId, purpose)
    : null;

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Privileged audit reconstruction</p>
          <h1>Case Replay</h1>
          <p>
            Reconstruct the exact retained case history across evidence, policy, assessment,
            integrity, scoring, interview, decision and credential records. Every replay is logged.
          </p>
        </div>
      </div>

      <form method="get" className="panel form-grid" aria-label="Case Replay request">
        <label>
          Assurance Case ID
          <input name="caseId" required defaultValue={caseId} pattern="assurance_case_[A-Za-z0-9_-]{24}" />
        </label>
        <label>
          Replay purpose
          <input name="purpose" required minLength={5} maxLength={1000} defaultValue={purpose} />
        </label>
        <button type="submit">Open Case Replay</button>
      </form>

      {replay ? (
        <section className="content-stack">
          <div className="panel">
            <h2>{replay.caseId}</h2>
            <p>Generated {replay.generatedAt}</p>
          </div>
          {Object.entries(replay.sections).map(([name, records]) => (
            <details className="panel" key={name} open={name === "case" || name === "timeline"}>
              <summary>{name.replaceAll("_", " ")} — {records.length} record(s)</summary>
              {records.length === 0 ? (
                <p>No retained records in this section.</p>
              ) : (
                <pre>{JSON.stringify(records, null, 2)}</pre>
              )}
            </details>
          ))}
        </section>
      ) : null}
    </section>
  );
}
