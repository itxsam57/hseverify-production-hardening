import Link from "next/link";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { AssuranceOrderService } from "@/lib/assurance/assurance-order-service";

export default async function AssuranceOrdersPage():Promise<React.JSX.Element>{
  const principal=await requireCurrentTenantPermission("company.orders.read");
  const orders=await new AssuranceOrderService(await getDatabaseClient()).listOrders(principal);
  return <section className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">Company assurance</p><h1>Assurance orders</h1><p>Create and track one formal verification request without losing worker-specific history.</p></div><Link className="button button-primary" href="/company/assurance-orders/new">Create assurance order</Link></div>
    {orders.length===0?<div className="empty-state"><h2>No assurance orders yet</h2><p>Create the first order when workers are linked and ready for assurance.</p></div>:<div className="table-scroll"><table><thead><tr><th>Reference</th><th>Name</th><th>Status</th><th>Updated</th><th>Open</th></tr></thead><tbody>{orders.map(order=><tr key={order.orderId}><td>{order.orderReference}</td><td>{order.orderName}</td><td>{order.orderStatus}</td><td>{new Date(order.updatedAt).toLocaleString()}</td><td><Link href={`/company/assurance-orders/${order.orderId}`}>Open order</Link></td></tr>)}</tbody></table></div>}
  </section>;
}
