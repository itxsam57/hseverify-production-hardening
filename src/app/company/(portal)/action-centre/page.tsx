import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { AssuranceActionCentreService } from "@/lib/assurance/assurance-action-centre-service";
import { CompanyActionCentreAnalyticsService } from "@/lib/assurance/company-action-centre-analytics-service";
import { AssuranceActionCentre } from "@/components/company/assurance-action-centre";
import { CompanyActionCentreAnalyticsPanel } from "@/components/company/company-action-centre-analytics";

export default async function CompanyActionCentrePage():Promise<React.JSX.Element>{
  const principal=await requireCurrentTenantPermission("company.orders.read");
  const database=await getDatabaseClient();
  const [items,analytics]=await Promise.all([
    new AssuranceActionCentreService(database).list(principal),
    new CompanyActionCentreAnalyticsService(database).snapshot(principal)
  ]);
  return <section className="page-stack"><div className="page-heading"><div><p className="eyebrow">Company assurance</p><h1>Action Centre</h1><p>Live workflow status, approvals, readiness, competency gaps and prioritized obligations within this Company scope.</p></div></div><CompanyActionCentreAnalyticsPanel analytics={analytics}/><AssuranceActionCentre items={items}/></section>;
}
