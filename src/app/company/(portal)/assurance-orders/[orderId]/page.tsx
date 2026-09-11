import { notFound } from "next/navigation";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { AssuranceOrderService } from "@/lib/assurance/assurance-order-service";
import { listAssuranceOrderPolicySnapshots } from "@/lib/policy/effective-policy-read-service";
import { AssuranceOrderWorkspace } from "@/components/company/assurance-order-workspace";

export default async function AssuranceOrderDetailPage({params}:{params:Promise<{orderId:string}>}):Promise<React.JSX.Element>{
  const {orderId}=await params;
  const principal=await requireCurrentTenantPermission("company.orders.read");
  const database=await getDatabaseClient();
  const service=new AssuranceOrderService(database);
  const order=await service.findOrder(principal,orderId);
  if(!order) notFound();
  const cases=await service.listCases(principal,orderId);
  const policySnapshots=await listAssuranceOrderPolicySnapshots(database,principal,orderId);
  return <section className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">Company assurance</p><h1>Assurance order</h1><p>{order.orderReference} · {order.orderStatus}</p></div></div>
    <AssuranceOrderWorkspace order={order} cases={cases}/>
    <section aria-labelledby="effective-policy-summary">
      <h2 id="effective-policy-summary">Applied effective policy</h2>
      {policySnapshots.length===0?<p>No case policy snapshot has been pinned yet. Submitted cases lock the exact applied policy version.</p>:<ul>{policySnapshots.map(snapshot=><li key={snapshot.caseId}><strong>{snapshot.workerAccountId}</strong> — global version <code>{snapshot.globalPolicyVersionId}</code> — {snapshot.tenantOverrideApplied?"Company tightening applied":"global policy only"}. Resolved policy: <code>{JSON.stringify(snapshot.effectiveValue)}</code></li>)}</ul>}
    </section>
    <section aria-labelledby="action-centre-summary"><h2 id="action-centre-summary">Action Centre</h2><p>Every pending case shows its current owner and exact next action. Use the Company Action Centre for safe internal commands.</p></section>
  </section>;
}
