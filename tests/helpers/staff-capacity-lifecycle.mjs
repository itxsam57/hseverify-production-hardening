import assert from "node:assert/strict";
import {seedWorkerPrincipal} from "./assessment-attempt-fixture.mjs";
import {loadWorkerRegistrationTs} from "./worker-registration-runtime-loader.mjs";
const {StaffProvisioningService}=loadWorkerRegistrationTs("src/lib/auth/staff-provisioning-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {ReviewQualityService}=loadWorkerRegistrationTs("src/lib/review/review-quality-service.ts");
const {createTotpCode,totpCounter}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
export async function assertStaffCapacityLifecycle(db,concurrentDatabase=null){
  const base=await seedWorkerPrincipal(db,"capacity-staff-admin");
  await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[base.accountId]);
  await db.query("UPDATE auth_sessions SET active_role='admin',expires_at='2099-01-01' WHERE session_id=$1",[base.sessionId]);
  const admin={...base,activeRole:"admin"},now=new Date();
  const staff=new StaffProvisioningService(new AuthAccessRepository(db),{pepper:"synthetic-staff-capacity-pepper-32-characters",sandboxEnabled:true,sandboxAccessKey:"synthetic-local-sandbox"},()=>now);
  const quality=new ReviewQualityService(db);
  for(const terminal of ["cancel","revoke","complete"]){
   const actor={inviterAccountId:admin.accountId,inviterSessionId:admin.sessionId,inviterRole:"admin"};
   const invitation=await staff.createInvitation({...actor,email:terminal+".capacity@example.test",role:"verifier",requestFingerprint:"capacity-"+terminal});
   const enrollment=await staff.beginEnrollment(invitation.token);
   const profile=await staff.completeProfile({combinedToken:enrollment.token,displayName:"Pending Capacity Staff",password:"SyntheticCapacity!Password2026"});
   const accountId=(await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1",[invitation.invitation.email])).rows[0].account_id;
   assert.equal((await quality.list(admin)).reviewers.some(row=>row.account_id===accountId),false,"unfinished enrollment must not be a capacity target");
   const input={accountId,maxOpenReviews:2,expectedRevision:0,reason:"Explicit safe staff workload limit."};
   const auditBefore=(await db.query("SELECT * FROM platform_audit_events ORDER BY audit_event_id")).rows;
   await assert.rejects(quality.setCapacity(admin,input));
   assert.deepEqual((await db.query("SELECT * FROM platform_audit_events ORDER BY audit_event_id")).rows,auditBefore);
   assert.equal((await db.query("SELECT 1 FROM reviewer_capacity_revisions WHERE account_id=$1",[accountId])).rows.length,0);
   if(terminal==="complete"){
    await staff.verifyEnrollmentTotp({combinedToken:enrollment.token,code:createTotpCode(profile.totpSecret,totpCounter(now))});
    assert.equal((await quality.list(admin)).reviewers.some(row=>row.account_id===accountId),true);
    await quality.setCapacity(admin,input);
    assert.equal((await db.query("SELECT 1 FROM reviewer_capacity_revisions WHERE account_id=$1",[accountId])).rows.length,1);
   }else{
    if(terminal==="cancel"&&concurrentDatabase){
     let attempt;
     await db.transaction(async tx=>{
      await tx.query("SELECT flow_id FROM auth_staff_enrollment_flows WHERE account_id=$1 FOR UPDATE",[accountId]);
      attempt=new ReviewQualityService(concurrentDatabase).setCapacity(admin,input).then(()=>({accepted:true}),error=>({error}));
      let waiting=false;
      for(let i=0;i<100;i++){
       await tx.query("SELECT pg_stat_clear_snapshot()");
       waiting=Boolean((await tx.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'SELECT flow_id FROM auth_staff_enrollment_flows%' ")).rows[0]);
       if(waiting)break;
       await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(waiting,true,"capacity must wait on the actual enrollment flow lock");
      const cancelling=new StaffProvisioningService(new AuthAccessRepository(tx),{pepper:"synthetic-staff-capacity-pepper-32-characters",sandboxEnabled:true,sandboxAccessKey:"synthetic-local-sandbox"},()=>now);
      await cancelling.cancelEnrollment(enrollment.token);
     });
     const result=await attempt;assert.ok(result.error);assert.equal(result.accepted,undefined);
    }else if(terminal==="cancel")await staff.cancelEnrollment(enrollment.token);
    else await staff.revokeInvitation({...actor,invitationId:invitation.invitation.invitationId});
    assert.equal((await db.query("SELECT 1 FROM auth_accounts WHERE account_id=$1",[accountId])).rows.length,0);
    await assert.rejects(quality.setCapacity(admin,input));
   }
  }
}

