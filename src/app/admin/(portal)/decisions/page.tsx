import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { DecisionRepository } from "@/lib/decision/decision-engine-repository";
import { createDecisionAction, createDecisionOverrideAction } from "./actions";

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ caseId?: string }> }): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.security.read" });
  const { caseId } = await searchParams;
  const decisions = caseId ? await new DecisionRepository().listByCase(caseId) : [];
  return <main><h1>Decision Engine</h1><p>Actor: {principal.accountId}</p><form action={createDecisionAction}><label>Case ID<input name="caseId" defaultValue={caseId ?? ""} required /></label><label>State<input name="state" required /></label><label>Reason code<input name="reasonCode" required /></label><label>Explanation<input name="explanation" required /></label><label>Rule version<input name="ruleVersion" required /></label><label>Input references<input name="inputReferences" required /></label><button type="submit">Create decision</button></form><h2>Manual override</h2><form action={createDecisionOverrideAction}><label>Decision ID<input name="decisionId" required /></label><label>Previous state<input name="previousState" required /></label><label>New state<input name="newState" required /></label><label>Reason<input name="reason" required /></label><label>Evidence reference<input name="evidenceReference" required /></label><input type="hidden" name="confirmed" value="true" /><button type="submit">Record override</button></form><ul>{decisions.map((decision) => <li key={decision.decisionId}>{decision.state}: {decision.reason.explanation}</li>)}</ul></main>;
}
