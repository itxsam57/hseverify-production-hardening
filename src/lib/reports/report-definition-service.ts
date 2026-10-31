import "server-only";
import {randomBytes} from "node:crypto";
import {runTenantScopedCommand} from "../authorization/tenant-scoped-command-guard";
import type {DatabaseClient} from "../database/database";
import {REPORT_FORMATS,ReportAccessError,ReportConflictError,ReportInputError,ReportNotFoundError,normalizeReportScope,type ReportFormat,type ReportScope} from "./report-delivery-domain";
import type {ReportExportPrincipal,ReportReadPrincipal} from "./report-delivery-repository";
import {runWorkerReportCommand,type WorkerReportPrincipal} from "./report-owner-access";
import {isCompanyReportType,isWorkerReportType,normalizeReportFilters,type CompanyReportType,type WorkerReportType,type ReportType,type ReportFilters} from "./report-types";

type Owner=Readonly<{kind:"company"|"worker";accountId:string;tenantId:string|null;membershipId:string|null}>;
type DefinitionInput<T extends ReportType>=Readonly<{definitionId?:string;expectedVersion?:number;name:string;reportType:T;format:ReportFormat;scope?:ReportScope;filters?:unknown;queueEmail?:boolean}>;
export type SavedReportDefinition=Readonly<{definitionId:string;version:number;name:string;reportType:ReportType;format:ReportFormat;scope:ReportScope;filters:ReportFilters;queueEmail:boolean}>;
type Row={definition_id:string;version:number;name:string;report_type:ReportType;format:ReportFormat;request_scope:unknown;request_filters:unknown;queue_email:boolean};
const SELECT_DEFINITION=`SELECT versions.* FROM report_definitions definitions JOIN report_definition_versions versions ON versions.definition_id=definitions.definition_id
 WHERE definitions.definition_id=$1 AND definitions.requested_by=$2 AND definitions.owner_kind=$3
 AND definitions.tenant_id IS NOT DISTINCT FROM $4::text AND definitions.membership_id IS NOT DISTINCT FROM $5::text`;
function definitionId(value:string):string {
 if(typeof value!=="string" || !/^report_definition_[A-Za-z0-9_-]{24}$/.test(value))throw new ReportInputError();return value;
}
function version(value:number):number {if(!Number.isInteger(value)||value<1||value>1000)throw new ReportInputError();return value;}
function json(value:unknown):unknown {return typeof value==="string"?JSON.parse(value):value;}
function saved(row:Row):SavedReportDefinition {
 return Object.freeze({definitionId:row.definition_id,version:Number(row.version),name:row.name,reportType:row.report_type,format:row.format,
  scope:normalizeReportScope(json(row.request_scope) as ReportScope),filters:normalizeReportFilters(json(row.request_filters)),queueEmail:row.queue_email});
}
async function allowed(db:DatabaseClient,owner:Owner,scope:unknown,type:ReportType):Promise<boolean>{
 const result=await db.query<{allowed:boolean}>("SELECT hse_report_owner_access($1,$2,$3,$4,$5::jsonb,$6) AS allowed",[owner.kind,owner.accountId,owner.tenantId,owner.membershipId,JSON.stringify(scope),type]);
 return result.rows[0]?.allowed===true;
}

export class ReportDefinitionService {
 constructor(private readonly database:DatabaseClient){}
 private async company<Result>(principal:ReportExportPrincipal|ReportReadPrincipal,operation:(db:DatabaseClient,owner:Owner)=>Promise<Result>):Promise<Result>{
  try{return await runTenantScopedCommand({database:this.database,principal,permission:principal.authorizedTenantPermission,
   operation:({database,scope})=>operation(database,{kind:"company",accountId:scope.accountId,tenantId:scope.tenantId,membershipId:scope.membershipId})});}
  catch(error){if((error as Error).name.startsWith("TenantScope"))throw new ReportAccessError();throw error;}
 }
 private worker<Result>(principal:WorkerReportPrincipal,operation:(db:DatabaseClient,owner:Owner)=>Promise<Result>):Promise<Result>{
  return runWorkerReportCommand(this.database,principal,db=>operation(db,{kind:"worker",accountId:principal.accountId,tenantId:null,membershipId:null}));
 }
 private async save(db:DatabaseClient,owner:Owner,input:DefinitionInput<ReportType>):Promise<SavedReportDefinition>{
  if(!input || typeof input.name!=="string" || input.name.trim().length<1 || input.name.trim().length>120 || /[\u0000-\u001f\u007f]/u.test(input.name) ||
    !REPORT_FORMATS.includes(input.format) || (input.queueEmail!==undefined && typeof input.queueEmail!=="boolean") ||
    !(owner.kind==="company"?isCompanyReportType(input.reportType):isWorkerReportType(input.reportType)) ||
    (owner.kind==="worker" && input.scope!==undefined))throw new ReportInputError();
  const scope=owner.kind==="company"?normalizeReportScope(input.scope??{}):{};
  let filters:ReportFilters;try{filters=normalizeReportFilters(input.filters);}catch{throw new ReportInputError();}
  if(filters.credentialId!==null && (owner.kind==="company" || input.reportType!=="credential-pdf"))throw new ReportInputError();
  if(!await allowed(db,owner,scope,input.reportType))throw new ReportAccessError();
  const id=input.definitionId===undefined?"report_definition_"+randomBytes(12).toString("hex"):definitionId(input.definitionId);
  let next=1;
  if(input.definitionId!==undefined){
   if(input.expectedVersion===undefined)throw new ReportInputError("The saved report version is required.");version(input.expectedVersion);
   const found=await db.query<{current_version:number}>(`SELECT current_version FROM report_definitions WHERE definition_id=$1 AND requested_by=$2 AND owner_kind=$3
    AND tenant_id IS NOT DISTINCT FROM $4::text AND membership_id IS NOT DISTINCT FROM $5::text FOR UPDATE`,[id,owner.accountId,owner.kind,owner.tenantId,owner.membershipId]);
   if(found.rows.length!==1)throw new ReportNotFoundError();
   if(Number(found.rows[0].current_version)!==input.expectedVersion || input.expectedVersion>=1000)throw new ReportConflictError("This saved report has changed. Reload it before editing.");
   next=input.expectedVersion+1;await db.query("UPDATE report_definitions SET current_version=$2 WHERE definition_id=$1",[id,next]);
  }else{
   if(input.expectedVersion!==undefined)throw new ReportInputError();
   await db.query("INSERT INTO report_definitions(definition_id,owner_kind,requested_by,tenant_id,membership_id,current_version) VALUES($1,$2,$3,$4,$5,1)",[id,owner.kind,owner.accountId,owner.tenantId,owner.membershipId]);
  }
  const result=await db.query<Row>(`INSERT INTO report_definition_versions(definition_id,version,name,report_type,format,request_scope,request_filters,queue_email)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING *`,[id,next,input.name.trim(),input.reportType,input.format,JSON.stringify(scope),JSON.stringify(filters),input.queueEmail??false]);
  return saved(result.rows[0]);
 }
 private async resolve(db:DatabaseClient,owner:Owner,id:string,requestedVersion?:number):Promise<SavedReportDefinition>{
  definitionId(id);if(requestedVersion!==undefined)version(requestedVersion);
  const result=await db.query<Row>(SELECT_DEFINITION+" AND versions.version=coalesce($6::integer,definitions.current_version)",[id,owner.accountId,owner.kind,owner.tenantId,owner.membershipId,requestedVersion??null]);
  const row=result.rows[0];if(!row || !await allowed(db,owner,json(row.request_scope),row.report_type))throw new ReportNotFoundError();return saved(row);
 }
 private async list(db:DatabaseClient,owner:Owner):Promise<readonly SavedReportDefinition[]>{
  const result=await db.query<Row>(`SELECT versions.* FROM report_definitions definitions JOIN report_definition_versions versions ON versions.definition_id=definitions.definition_id AND versions.version=definitions.current_version
   WHERE definitions.requested_by=$1 AND definitions.owner_kind=$2 AND definitions.tenant_id IS NOT DISTINCT FROM $3::text AND definitions.membership_id IS NOT DISTINCT FROM $4::text ORDER BY definitions.created_at DESC,definitions.definition_id`,[owner.accountId,owner.kind,owner.tenantId,owner.membershipId]);
  const visible:SavedReportDefinition[]=[];for(const row of result.rows)if(await allowed(db,owner,json(row.request_scope),row.report_type))visible.push(saved(row));return Object.freeze(visible);
 }
 saveCompany(principal:ReportExportPrincipal,input:DefinitionInput<CompanyReportType>){return this.company(principal,(db,owner)=>this.save(db,owner,input));}
 listCompany(principal:ReportReadPrincipal){return this.company(principal,(db,owner)=>this.list(db,owner));}
 resolveCompany(principal:ReportExportPrincipal,id:string,requestedVersion?:number){return this.company(principal,(db,owner)=>this.resolve(db,owner,id,requestedVersion));}
 saveWorker(principal:WorkerReportPrincipal,input:Omit<DefinitionInput<WorkerReportType>,"scope">){return this.worker(principal,(db,owner)=>this.save(db,owner,input));}
 listWorker(principal:WorkerReportPrincipal){return this.worker(principal,(db,owner)=>this.list(db,owner));}
 resolveWorker(principal:WorkerReportPrincipal,id:string,requestedVersion?:number){return this.worker(principal,(db,owner)=>this.resolve(db,owner,id,requestedVersion));}
}
