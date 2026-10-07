import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "./worker-assessment-search-fixture.mjs";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {StaffProvisioningService}=loadWorkerRegistrationTs("src/lib/auth/staff-provisioning-service.ts");
// Actual invitation producers; search evidence does not certify recipient enrollment or delivery.
export async function rootInvitationSearchFixture(){
 const fixture=await workerAssessmentSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const repository=new AuthAccessRepository(db);
  const service=new StaffProvisioningService(repository,{pepper:fixture.environment.HSE_AUTH_PEPPER,sandboxEnabled:false,sandboxAccessKey:null});
  const create=(email,issuer=fixture.credentials.root)=>service.createInvitation({inviterAccountId:issuer.accountId,inviterRole:issuer===fixture.credentials.root?"root":"admin",email,role:"verifier",requestFingerprint:email});
  const alpha=await create("search-alpha@invitation.example.test");
  await db.query("UPDATE auth_staff_invitations SET created_at=$2 WHERE invitation_id=$1",[alpha.invitation.invitationId,new Date(Date.now()-86400000).toISOString()]);
  for(let n=0;n<26;n++)await create("earlier-"+n+"@invitation.example.test");
  const beta=await create("search-beta@invitation.example.test");
  const foreign=await create("search-alpha-foreign@invitation.example.test",fixture.credentials.admin);
  return {...fixture,alpha:alpha.invitation,beta:beta.invitation,foreign:foreign.invitation};
 }catch(error){await fixture.cleanup();throw error;}finally{await db.close();}
}
