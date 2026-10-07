import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {rootInvitationSearchFixture} from "../helpers/root-invitation-search-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {StaffProvisioningService}=loadWorkerRegistrationTs("src/lib/auth/staff-provisioning-service.ts");
test("Root invitation search filters actual owned invitations before the recent25 limit",{timeout:120000},async()=>{
 const fixture=await rootInvitationSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const service=new StaffProvisioningService(new AuthAccessRepository(db),{pepper:fixture.environment.HSE_AUTH_PEPPER,sandboxEnabled:false,sandboxAccessKey:null}),actor=fixture.credentials.root.accountId;
  assert.deepEqual((await service.listInvitations(actor,"search-alpha")).map(x=>x.invitationId),[fixture.alpha.invitationId],"Query must find the older owned invitation beyond25 while excluding foreign issuer");
  assert.deepEqual((await service.listInvitations(actor,fixture.beta.invitationId)).map(x=>x.invitationId),[fixture.beta.invitationId]);
  for(const q of ["' OR 1=1 --","%","z".repeat(10000)])assert.equal((await service.listInvitations(actor,q)).length,0);
  assert.equal((await service.listInvitations(actor," ")).length,25);
 }finally{await db.close();await fixture.cleanup();}
});
