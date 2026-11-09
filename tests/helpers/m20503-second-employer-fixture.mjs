import {createHash} from "node:crypto";
import {fundingPrincipal} from "./assessment-funding-fixture.mjs";
import {loadWorkerRegistrationTs} from "./worker-registration-runtime-loader.mjs";

const {CompanyWorkforceService}=loadWorkerRegistrationTs("src/lib/company/company-workforce-service.ts");
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);

// Isolated verified Company fixture; invitation and acceptance use real services/browser.
export async function seedSecondEmployerInvitation(database,fixture){
  const now=new Date().toISOString(),key="m20503-verified-second-employer";
  const accountId=id("account",key),tenantId=id("tenant",key);
  const membershipId=id("membership",key),caseId=id("company_verification",key);
  const versionId=id("company_verification_version",key);
  await database.query(
    "INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) "+
    "SELECT $1,'m20503-second-employer@example.test','Second verified employer','active',password_hash,$2,$2,$2,$2 FROM auth_accounts WHERE account_id=$3",
    [accountId,now,fixture.credentials.company.accountId]
  );
  await database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[accountId,now]);
  await database.query(
    "INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at) "+
    "VALUES($1,'company','Second verified employer','active',$2,$3,$3,$3)",
    [tenantId,accountId,now]
  );
  await database.query(
    "INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at) "+
    "VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)",
    [membershipId,tenantId,accountId,now]
  );
  await database.query(
    "INSERT INTO company_verification_cases(case_id,tenant_id,owner_account_id,current_version_id,case_status,lock_version,created_at,updated_at,submitted_at,verified_at) "+
    "VALUES($1,$2,$3,NULL,'verified',2,$4,$4,$4,$4)",
    [caseId,tenantId,accountId,now]
  );
  await database.query(
    "INSERT INTO company_verification_versions(version_id,case_id,version_number,parent_version_id,version_status,draft_revision,legal_name,trading_name,registration_number,country,industry,company_size,website,authorized_representative,business_email_normalized,business_phone_e164,terms_accepted_at,privacy_accepted_at,created_at,updated_at,submitted_at,terminal_at) "+
    "VALUES($1,$2,1,NULL,'verified',0,'Second verified employer','Second verified employer','M20503-SECOND-EMPLOYER','Pakistan','Construction','51-200','https://second-employer.example.test','Second employer owner','m20503-second-employer@example.test','+923009876542',$3,$3,$3,$3,$3,$3)",
    [versionId,caseId,now]
  );
  await database.query("UPDATE company_verification_cases SET current_version_id=$2 WHERE case_id=$1",[caseId,versionId]);
  const principal=await fundingPrincipal(database,{accountId,tenantId,membershipId,membershipRole:"owner"},"company");
  const secret=await new CompanyWorkforceService(database,fixture.environment.HSE_AUTH_PEPPER)
    .inviteWorker({...principal,authorizedTenantPermission:"company.workforce.manage"},{
      email:fixture.credentials.worker.email,siteId:null,departmentId:null,
      paymentResponsibility:"worker",assessmentReference:null
    });
  return {tenantId,invitationPath:secret.invitationPath};
}
