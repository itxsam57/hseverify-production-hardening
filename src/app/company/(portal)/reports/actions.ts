"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createIdentifier} from "@/lib/auth/auth-domain";
import {requireCurrentTenantPermission} from "@/lib/authorization/authorization-service";
import {deriveTrustedTenantScope} from "@/lib/authorization/tenant-scoped-resource-domain";
import {getDatabaseClient} from "@/lib/database/database";
import {ReportInputError,ReportConflictError,normalizeReportScope,type ReportFormat} from "@/lib/reports/report-delivery-domain";
import {ReportDeliveryService} from "@/lib/reports/report-delivery-service";
import {ReportDefinitionService} from "@/lib/reports/report-definition-service";
import {isCompanyReportType,normalizeReportFilters} from "@/lib/reports/report-types";
function value(form:FormData,name:string):string{const entry=form.get(name);return typeof entry==="string"?entry:"";}
function notice(error:unknown):string{return error instanceof ReportInputError || error instanceof ReportConflictError?error.message:"The report request could not be completed.";}
function utc(raw:string):string|undefined{
 if(!raw)return undefined;
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw) || !Number.isFinite(Date.parse(raw+"Z")))throw new ReportInputError("Enter a valid UTC date and time.");
 const canonical=new Date(raw+"Z").toISOString();
 if(canonical.slice(0,raw.length)!==raw)throw new ReportInputError("Enter a valid UTC date and time.");
 return canonical;
}
function configuration(form:FormData){
 const reportType=value(form,"reportType")||"workforce-status";
 if(!isCompanyReportType(reportType))throw new ReportInputError("Report type is invalid.");
 const filters=normalizeReportFilters({from:utc(value(form,"fromAt"))??null,to:utc(value(form,"toAt"))??null,
  expiryDays:value(form,"expiryDays")?Number(value(form,"expiryDays")):30});
 return {reportType,format:value(form,"format") as ReportFormat,scope:normalizeReportScope({
  siteId:value(form,"siteId")||null,departmentId:value(form,"departmentId")||null}),filters,queueEmail:form.get("queueEmail")==="on"};
}
function finish(errorMessage:string|null,noticeValue:string):never{
 revalidatePath("/company/reports");redirect("/company/reports?"+(errorMessage?"error="+encodeURIComponent(errorMessage):"notice="+noticeValue));
}
export async function queueReport(form:FormData):Promise<void>{
 const principal=await requireCurrentTenantPermission("company.reports.export"),scope=deriveTrustedTenantScope(principal);
 let errorMessage:string|null=null;
 try{
  const definitionId=value(form,"definitionId"),definition=definitionId?await new ReportDefinitionService(await getDatabaseClient()).resolveCompany(principal,definitionId,Number(value(form,"definitionVersion"))):null;
  const config=definition??configuration(form);
  if(!isCompanyReportType(config.reportType))throw new ReportInputError("Company report type is invalid.");
  await new ReportDeliveryService().queue({reportId:createIdentifier("report"),reportType:config.reportType,
   tenantId:scope.tenantId,requestedBy:principal.accountId,format:config.format,requestedAt:new Date().toISOString(),
   scheduleAt:utc(value(form,"scheduleAt")),siteId:config.scope.siteId,departmentId:config.scope.departmentId,
   filters:config.filters,queueEmail:config.queueEmail,definitionId:definition?.definitionId,definitionVersion:definition?.version},principal);
 }catch(error){errorMessage=notice(error);}
 finish(errorMessage,"queued");
}
export async function saveReportDefinition(form:FormData):Promise<void>{
 const principal=await requireCurrentTenantPermission("company.reports.export");let errorMessage:string|null=null;
 try{
  const definitionId=value(form,"editDefinitionId");
  await new ReportDefinitionService(await getDatabaseClient()).saveCompany(principal,{
   ...configuration(form),name:value(form,"definitionName"),definitionId:definitionId||undefined,
   expectedVersion:definitionId?Number(value(form,"expectedVersion")):undefined
  });
 }catch(error){errorMessage=notice(error);}
 finish(errorMessage,"saved");
}
export async function retryReport(form:FormData):Promise<void>{
 const principal=await requireCurrentTenantPermission("company.reports.export");let errorMessage:string|null=null;
 try{await new ReportDeliveryService().retry(principal,value(form,"reportId"));}catch(error){errorMessage=notice(error);}
 finish(errorMessage,"retried");
}
export async function listCompanyReports(){const principal=await requireCurrentTenantPermission("company.reports.read");return (await new ReportDeliveryService().workspace(principal)).reports;}
export async function companyReportWorkspace(){
 const principal=await requireCurrentTenantPermission("company.reports.read"),workspace=await new ReportDeliveryService().workspace(principal);
 return {...workspace,definitions:await new ReportDefinitionService(await getDatabaseClient()).listCompany(principal)};
}
