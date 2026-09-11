import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { AssuranceActionCentreService } from "@/lib/assurance/assurance-action-centre-service";
import { AssuranceActionCentre } from "@/components/company/assurance-action-centre";
export default async function CompanyActionCentrePage():Promise<React.JSX.Element>{const principal=await requireCurrentTenantPermission("company.orders.read");const items=await new AssuranceActionCentreService(await getDatabaseClient()).list(principal);return <section className="page-stack"><div className="page-heading"><div><p className="eyebrow">Company assurance</p><h1>Action Centre</h1><p>Prioritized assurance obligations with an explicit owner, reason, due date and allowed action.</p></div></div><AssuranceActionCentre items={items}/></section>;}
