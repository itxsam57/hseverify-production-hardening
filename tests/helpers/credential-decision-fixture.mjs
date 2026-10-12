import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "./migration-ceiling.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

// Isolated schema-valid completed review inputs. Decision, issuance and storage use the actual producer.
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"credential-pdf-unicode-runtime",sessionSecret:"credential-validity-session-test-secret-more-than-32",authPepper:"credential-validity-auth-pepper-test-more-than-32",authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false};
const KEY="credential-validity-dedicated-test-signing-key-more-than-32";
const ISSUED="2026-09-25T11:00:00.127Z";
const tenantId="tenant_"+"a".repeat(24),caseId="assurance_case_"+"d".repeat(24);
const snapshotId="policy_snapshot_"+"s".repeat(24),versionId="policy_version_"+"v".repeat(24);
export async function credentialDecisionFixture({policy={credentialValidityDays:30},qualification="Operational Safety"}={}) {
 const database=await openScriptDatabase(ENV);
 await applyMigrationsThrough(database,ENV.releaseSha,"0067_assessment_review_orchestration");
 const orderId="assurance_order_"+"b".repeat(24), targetId="assurance_target_"+"c".repeat(24);
 await database.query(`INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,credential_target,order_status,submitted_at,created_at,updated_at,effective_policy_reference,assessment_framework_references) VALUES($1,$2,'membership_validity_owner','Validity order','VALIDITY-1',$6,'SUBMITTED',$3,$3,$3,$4,$5::jsonb)`,[orderId,tenantId,ISSUED,null,"[]",qualification]);
 await database.query(`INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,'worker_link_validity','worker_account_validity','worker_id_validity_000001','company','submitted',$4,$4)`,[targetId,orderId,tenantId,ISSUED]);
 await database.query(`INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,'worker_link_validity','worker_account_validity','worker_id_validity_000001','Decision pending','admin','Record decision',$5,$5)`,[caseId,orderId,targetId,tenantId,ISSUED]);
 if(policy!==null) await database.query(`INSERT INTO assurance_case_policy_snapshots(snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at) VALUES($1,$2,$3,$4,$5,$6,NULL,'GLOBAL',$7::jsonb,$8,$8)`,[snapshotId,caseId,tenantId,"framework_"+"f".repeat(24),"policy_"+"p".repeat(24),versionId,JSON.stringify(policy),ISSUED]);
 const {DecisionRepository}=loadTs("src/lib/decision/decision-engine-repository.ts");
 const {createDecision}=loadTs("src/lib/decision/decision-engine-domain.ts");
 const decision=createDecision({tenantId,caseId,state:"APPROVED",reasonCode:"ready",explanation:"Evidence and assessment passed.",ruleVersion:"validity-test-v1",inputReferences:["assessment-validity"],createdAt:ISSUED});
 return {database,decision,repo:new DecisionRepository(Promise.resolve(database),KEY),signingSecret:KEY,environment:ENV,tenantId,caseId};
}
