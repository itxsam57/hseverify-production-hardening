import { createAssuranceOrderAction } from "../actions";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { deriveTrustedTenantScope } from "@/lib/authorization/tenant-scoped-resource-domain";
import { getDatabaseClient } from "@/lib/database/database";

type LinkRow={link_id:string;worker_account_id:string;permanent_worker_id:string|null;site_id:string|null;department_id:string|null};
export default async function NewAssuranceOrderPage():Promise<React.JSX.Element>{
 const principal=await requireCurrentTenantPermission("company.orders.manage"); const scope=deriveTrustedTenantScope(principal); const database=await getDatabaseClient();
 const links=await database.query<LinkRow>(`SELECT link_id,worker_account_id,permanent_worker_id,site_id,department_id FROM company_worker_links WHERE tenant_id=$1 AND link_status='active' ORDER BY worker_account_id LIMIT 500`,[scope.tenantId]);
 return <section className="page-stack"><div className="page-heading"><div><p className="eyebrow">Company assurance</p><h1>Create assurance order</h1><p>Save a tenant-scoped request. Later-brick dependencies remain blocked until their engines exist.</p></div></div>
 <form action={createAssuranceOrderAction} className="form-card form-grid">
  <label>Order name<input name="orderName" required minLength={2} maxLength={160}/></label><label>Order reference<input name="orderReference" required maxLength={120}/></label>
  <label>Site reference<input name="siteId" maxLength={80}/></label><label>Department reference<input name="departmentId" maxLength={80}/></label>
  <label className="field-span">Requested identity checks<textarea name="requestedIdentityChecks" rows={2}/></label><label className="field-span">Requested evidence checks<textarea name="requestedEvidenceChecks" rows={2}/></label>
  <label className="field-span">Assessment framework references<textarea name="assessmentFrameworkReferences" rows={2} aria-describedby="framework-note"/><small id="framework-note">M2.03 validation is not available yet; populated references will keep this order from READY.</small></label>
  <label><input type="checkbox" name="interviewRequired"/> Interview required</label><label>Credential target<input name="credentialTarget" maxLength={160}/></label>
  <label>Deadline<input name="deadline" type="datetime-local"/></label><label>Effective policy reference<input name="effectivePolicyReference" maxLength={160}/></label>
  <label className="field-span">Company notes<textarea name="companyNotes" rows={3} maxLength={4000}/></label><label>Purchase order reference<input name="purchaseOrderReference" maxLength={160}/></label>
  <fieldset className="field-span"><legend>Workers</legend>{links.rows.length===0?<p>No active linked Workers are available.</p>:links.rows.map(link=><label key={link.link_id}><input type="checkbox" name="workerLinkIds" value={link.link_id}/> {link.permanent_worker_id??link.worker_account_id}</label>)}</fieldset>
  <label>Funding method<select name="fundingMethod" defaultValue="worker"><option value="worker">Worker</option><option value="company">Company</option></select></label>
  <div className="field-span form-actions"><button className="button button-primary" type="submit">Save Draft</button></div>
 </form></section>;
}
