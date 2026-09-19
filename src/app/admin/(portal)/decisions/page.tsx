import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { DecisionRepository } from "@/lib/decision/decision-engine-repository";
import { createDecisionAction, createDecisionOverrideAction } from "./actions";

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ caseId?: string; tenantId?: string }> }): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" });
  const { caseId, tenantId } = await searchParams;
  const repository = new DecisionRepository();
  const scopedTenantId = tenantId ?? "";
  const decisions = caseId && scopedTenantId ? await repository.listByCase(caseId, scopedTenantId) : [];
  const overrides = await Promise.all(
    decisions.map((decision) => repository.listOverrides(decision.decisionId, scopedTenantId))
  );

  return (
    <main>
      <h1>Decision Engine</h1>
      <p>Actor: {principal.accountId}</p>
      <form method="get">
        <label>Tenant ID<input name="tenantId" defaultValue={tenantId ?? ""} required /></label>
        <label>Case ID<input name="caseId" defaultValue={caseId ?? ""} required /></label>
        <button type="submit">Load case decisions</button>
      </form>
      <form action={createDecisionAction}>
        <label>Tenant ID<input name="tenantId" defaultValue={tenantId ?? ""} required /></label>
        <label>Case ID<input name="caseId" defaultValue={caseId ?? ""} required /></label>
        <label>State<input name="state" required /></label>
        <label>Reason code<input name="reasonCode" required /></label>
        <label>Explanation<input name="explanation" required /></label>
        <label>Rule version<input name="ruleVersion" required /></label>
        <label>Input references<input name="inputReferences" required /></label>
        <button type="submit">Create decision</button>
      </form>
      <h2>Manual override</h2>
      <form action={createDecisionOverrideAction}>
        <label>Tenant ID<input name="tenantId" defaultValue={tenantId ?? ""} required /></label>
        <label>Decision ID<input name="decisionId" required /></label>
        <label>Previous state<input name="previousState" required /></label>
        <label>New state<input name="newState" required /></label>
        <label>Reason<input name="reason" required /></label>
        <label>Evidence reference<input name="evidenceReference" required /></label>
        <input type="hidden" name="confirmed" value="true" />
        <button type="submit">Record override</button>
      </form>
      <ul>
        {decisions.map((decision, index) => (
          <li key={decision.decisionId}>
            <code>{decision.decisionId}</code> — <strong>{decision.state}</strong>: {decision.reason.explanation} ({decision.ruleVersion})
            {overrides[index].length > 0 ? (
              <ul>
                {overrides[index].map((override) => (
                  <li key={override.overrideId}>Override: {override.newState} — {override.reason}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
