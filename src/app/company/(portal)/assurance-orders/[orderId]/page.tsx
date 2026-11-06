import { notFound } from "next/navigation";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { CURRENT_CREDENTIAL_STATUS_SQL } from "@/lib/credential/current-credential-status-sql";
import { AssuranceOrderService } from "@/lib/assurance/assurance-order-service";
import { listAssuranceOrderPolicySnapshots } from "@/lib/policy/effective-policy-read-service";
import { AssuranceOrderWorkspace } from "@/components/company/assurance-order-workspace";

export default async function AssuranceOrderDetailPage({params,searchParams}:{params:Promise<{orderId:string}>;searchParams:Promise<{error?:string}>}):Promise<React.JSX.Element>{
  const {orderId}=await params;
  const error=(await searchParams).error;
  const principal=await requireCurrentTenantPermission("company.orders.read");
  const database=await getDatabaseClient();
  const service=new AssuranceOrderService(database);
  const order=await service.findOrder(principal,orderId);
  if(!order) notFound();
  const cases=await service.listCases(principal,orderId);
  const interviewSchedules=await service.listInterviewSchedules(principal,orderId);
  const policySnapshots=await listAssuranceOrderPolicySnapshots(database,principal,orderId);
  const credentialRows=await database.query<{case_id:string;credential_status:string|null}>(`
    SELECT cases.case_id,${CURRENT_CREDENTIAL_STATUS_SQL} AS credential_status FROM assurance_cases AS cases
    LEFT JOIN credential_issuances AS credentials ON credentials.credential_id=cases.credential_reference
      AND credentials.worker_id=cases.permanent_worker_id
    WHERE cases.tenant_id=$1 AND cases.order_id=$2`,[order.tenantId,order.orderId]);
  const credentialStatuses=Object.fromEntries(credentialRows.rows.map(row=>[row.case_id,row.credential_status]));
  return <section className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">Company assurance</p><h1>Assurance order</h1><p>{order.orderReference} · {order.orderStatus}</p></div></div>
    {typeof error==="string"&&error?<p role="alert" className="status-banner status-error">{error.slice(0,500)}</p>:null}
    <AssuranceOrderWorkspace order={order} cases={cases} interviewSchedules={interviewSchedules} credentialStatuses={credentialStatuses}/>
    <section aria-labelledby="effective-policy-summary">
      <h2 id="effective-policy-summary">Applied effective policy</h2>
      {policySnapshots.length===0?<p>No case policy snapshot has been pinned yet. Submitted cases lock the exact applied policy version.</p>:<ul>{policySnapshots.map(snapshot=><li key={snapshot.caseId}><strong>{snapshot.workerAccountId}</strong> — global version <code>{snapshot.globalPolicyVersionId}</code> — {snapshot.tenantOverrideApplied?"Company tightening applied":"global policy only"}. Resolved policy: <code>{JSON.stringify(snapshot.effectiveValue)}</code></li>)}</ul>}
    </section>
    <section aria-labelledby="action-centre-summary"><h2 id="action-centre-summary">Action Centre</h2><p>Every pending case shows its current owner and exact next action. Use the Company Action Centre for safe internal commands.</p></section>
  </section>;
}
