import {randomBytes} from "node:crypto";
import {loadWorkerRegistrationTs} from "./worker-registration-runtime-loader.mjs";
const {EffectivePolicyService,pinAssuranceCasePolicySnapshot}=loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const {EvidenceReviewFrameworkService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-framework-service.ts");
const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
// Test setup exercises the same authenticated Admin producers as the UI. No production exemption.
export async function authorizeReviewFixture(database,{taskId,verifiers,at=new Date()}){
 const suffix=randomBytes(18).toString("base64url"),accountId="account_"+suffix,sessionId="session_"+suffix;
 const from=new Date("2000-01-01T00:00:00.000Z"),until=new Date("2099-01-01T00:00:00.000Z"),reference="TEST-REVIEW-"+suffix;
 await database.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,'Fixture Calibration Admin','active','scrypt$16384$8$1$salt$hash',$3,$3,$3,$3)`,[accountId,suffix+"@calibration.test",from.toISOString()]);
 await database.query(`INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)`,[accountId,from.toISOString()]);
 await database.query(`INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'admin',$3,$4,$5,$5,$6)`,[sessionId,accountId,"token-"+suffix,"csrf-"+suffix,from.toISOString(),until.toISOString()]);
 const admin={accountId,sessionId,activeRole:"admin",accountStatus:"active",tenantMembership:null,email:suffix+"@calibration.test",displayName:"Fixture Calibration Admin",createdAt:from.toISOString(),lastSeenAt:from.toISOString(),expiresAt:until.toISOString()};
 const task=(await database.query("SELECT case_id,tenant_id FROM evidence_review_tasks WHERE task_id=$1",[taskId])).rows[0];if(!task)throw new Error("Actual review task must exist before fixture authorization.");
 const policy=new EffectivePolicyService(database),frameworks=new EvidenceReviewFrameworkService(Promise.resolve(database));
 let pinned=task.case_id?(await database.query("SELECT framework_id,reference_time FROM assurance_case_policy_snapshots WHERE case_id=$1",[task.case_id])).rows[0]:null;
 let frameworkId=pinned?.framework_id;
 if(!frameworkId){frameworkId=await policy.createFramework(admin,{reference,title:"Explicit fixture review standard"},from);
  if(task.case_id){await policy.publishPolicyVersion(admin,{frameworkReference:reference,policyReference:reference,title:"Explicit fixture case policy",effectiveFrom:from,effectiveTo:null,policyValues:{pass_mark:80},overrideAllowedFields:[],overrideDirections:{}},at);await pinAssuranceCasePolicySnapshot(database,{caseId:task.case_id,tenantId:task.tenant_id,frameworkReferences:[reference],policyReference:reference,referenceTime:at,actorAccountId:admin.accountId,actorPrincipal:admin});pinned={reference_time:at};}
 }
 const revision=(await database.query(`SELECT * FROM assurance_framework_revisions WHERE framework_id=$1 AND effective_from<=$2 ORDER BY effective_from DESC,version_no DESC LIMIT 1`,[frameworkId,new Date(pinned?.reference_time??at).toISOString()])).rows[0];if(!revision)throw new Error("Actual authoritative framework revision required.");
 const binding=(await database.query("SELECT binding_id FROM evidence_review_framework_bindings WHERE task_id=$1 ORDER BY binding_sequence DESC LIMIT 1",[taskId])).rows[0];
 if(!binding)await frameworks.bind(admin,{taskId,frameworkVersionId:revision.framework_version_id,reason:"Explicit approved applicability for the representative test journey.",expectedBindingId:null},at);
 for(const verifier of verifiers)await new StaffCalibrationService(Promise.resolve(database)).record(admin,{accountId:verifier.accountId,role:"verifier",frameworkReference:revision.framework_reference,frameworkVersionId:revision.framework_version_id,status:"CURRENT",validFrom:new Date(revision.effective_from),validUntil:until,note:"Observed benchmark calibration against this exact authoritative revision."});
 return {admin,frameworkId,frameworkVersionId:revision.framework_version_id};
}
