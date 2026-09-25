import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { DECISION_STATES } from "@/lib/decision/decision-engine-domain";
import { DecisionRepository } from "@/lib/decision/decision-engine-repository";
import { createDecisionAction, createDecisionOverrideAction } from "./actions";

type SearchParams = Promise<{ caseId?: string; tenantId?: string }>;

export default async function DecisionsPage({
  searchParams
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const { caseId, tenantId } = await searchParams;
  const repository = new DecisionRepository();
  const scopedTenantId = tenantId?.trim() ?? "";
  const scopedCaseId = caseId?.trim() ?? "";
  const decisions =
    scopedCaseId && scopedTenantId
      ? await repository.listByCase(scopedCaseId, scopedTenantId)
      : [];
  const overrides = await Promise.all(
    decisions.map((decision) =>
      repository.listOverrides(decision.decisionId, scopedTenantId)
    )
  );

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Platform operations</p>
          <h1>Decision Engine</h1>
          <p>
            Load one Assurance Case, review its decision history, create a reasoned
            decision and record controlled overrides without replacing prior history.
          </p>
        </div>
      </div>

      <section className="dashboard-section" aria-labelledby="decision-scope-heading">
        <p className="section-kicker">Case scope</p>
        <h2 id="decision-scope-heading">Load decision history</h2>
        <p className="muted-copy">
          Signed in as <code>{principal.accountId}</code>. Tenant and case scope are
          required so the server can enforce the exact record boundary.
        </p>
        <form method="get" className="form-grid">
          <label>
            Tenant ID
            <input
              name="tenantId"
              defaultValue={tenantId ?? ""}
              required
              autoComplete="off"
            />
          </label>
          <label>
            Case ID
            <input
              name="caseId"
              defaultValue={caseId ?? ""}
              required
              autoComplete="off"
            />
          </label>
          <div className="button-row">
            <button type="submit">Load case decisions</button>
          </div>
        </form>
      </section>

      <section className="dashboard-section" aria-labelledby="create-decision-heading">
        <p className="section-kicker">Decision</p>
        <h2 id="create-decision-heading">Create decision</h2>
        <form action={createDecisionAction} className="form-grid">
          <label>
            Tenant ID
            <input
              name="tenantId"
              defaultValue={tenantId ?? ""}
              required
              autoComplete="off"
            />
          </label>
          <label>
            Case ID
            <input
              name="caseId"
              defaultValue={caseId ?? ""}
              required
              autoComplete="off"
            />
          </label>
          <label>
            State
            <select name="state" defaultValue="PENDING_ADDITIONAL_REVIEW" required>
              {DECISION_STATES.map((state) => (
                <option value={state} key={state}>
                  {state.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason code
            <input
              name="reasonCode"
              required
              minLength={2}
              maxLength={120}
              placeholder="e.g. evidence_complete"
            />
          </label>
          <label className="form-grid-wide">
            Explanation
            <textarea
              name="explanation"
              required
              minLength={5}
              maxLength={4000}
              rows={4}
              placeholder="Explain the outcome in language that can be audited and shown where authorized."
            />
          </label>
          <label>
            Rule version
            <input
              name="ruleVersion"
              required
              minLength={1}
              maxLength={160}
              placeholder="e.g. hse-core-v1"
            />
          </label>
          <label>
            Input references
            <input
              name="inputReferences"
              required
              placeholder="Comma-separated evidence / review references"
            />
          </label>
          <div className="button-row form-grid-wide">
            <button type="submit">Create decision</button>
          </div>
        </form>
      </section>

      <section className="dashboard-section" aria-labelledby="manual-override-heading">
        <p className="section-kicker">Privileged amendment</p>
        <h2 id="manual-override-heading">Manual override</h2>
        <p className="muted-copy">
          The original decision remains preserved. Use this only when the evidence
          and authorization for an override are already established.
        </p>
        <form action={createDecisionOverrideAction} className="form-grid">
          <label>
            Tenant ID
            <input
              name="tenantId"
              defaultValue={tenantId ?? ""}
              required
              autoComplete="off"
            />
          </label>
          <label>
            Decision ID
            <input name="decisionId" required autoComplete="off" />
          </label>
          <label>
            Previous state
            <select name="previousState" defaultValue="PENDING_ADDITIONAL_REVIEW" required>
              {DECISION_STATES.map((state) => (
                <option value={state} key={state}>
                  {state.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            New state
            <select name="newState" defaultValue="APPROVED" required>
              {DECISION_STATES.map((state) => (
                <option value={state} key={state}>
                  {state.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="form-grid-wide">
            Reason
            <textarea name="reason" required minLength={5} maxLength={4000} rows={4} />
          </label>
          <label className="form-grid-wide">
            Evidence reference
            <input name="evidenceReference" required autoComplete="off" />
          </label>
          <input type="hidden" name="confirmed" value="true" />
          <div className="button-row form-grid-wide">
            <button type="submit">Record override</button>
          </div>
        </form>
      </section>

      <section className="dashboard-section" aria-labelledby="decision-history-heading">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">History</p>
            <h2 id="decision-history-heading">Case decisions</h2>
          </div>
          <span className="status-badge status-neutral">
            {decisions.length} record{decisions.length === 1 ? "" : "s"}
          </span>
        </div>

        {!scopedCaseId || !scopedTenantId ? (
          <div className="empty-state">
            <h3>Load a case first</h3>
            <p>Enter a Tenant ID and Case ID above to inspect its preserved decision history.</p>
          </div>
        ) : decisions.length === 0 ? (
          <div className="empty-state">
            <h3>No decisions recorded</h3>
            <p>This Assurance Case does not yet have a decision in the selected tenant scope.</p>
          </div>
        ) : (
          <div className="record-list">
            {decisions.map((decision, index) => (
              <article className="side-record-card" key={decision.decisionId}>
                <div className="section-heading-row">
                  <div>
                    <h3>{decision.state.replaceAll("_", " ")}</h3>
                    <p>
                      <code>{decision.decisionId}</code>
                    </p>
                  </div>
                  <span className="status-badge status-neutral">{decision.ruleVersion}</span>
                </div>
                <p>
                  <strong>{decision.reason.code}</strong> — {decision.reason.explanation}
                </p>
                <p className="muted-copy">
                  Inputs: {decision.inputReferences.join(", ")}
                </p>
                {overrides[index].length > 0 ? (
                  <div className="content-stack">
                    <h3>Overrides</h3>
                    {overrides[index].map((override) => (
                      <div className="record-row" key={override.overrideId}>
                        <div>
                          <strong>
                            {override.previousState.replaceAll("_", " ")} →{" "}
                            {override.newState.replaceAll("_", " ")}
                          </strong>
                          <p>{override.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
