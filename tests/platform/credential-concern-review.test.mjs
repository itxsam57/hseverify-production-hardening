import assert from "node:assert/strict";
import test from "node:test";
import { readFile,mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { listMigrations } from "../../scripts/lib/migrations.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { credentialDecisionFixture } from "../helpers/credential-decision-fixture.mjs";
import { loadWorkerRegistrationTs as loadTs } from "../helpers/worker-registration-runtime-loader.mjs";
const {CredentialConcernReviewService,ConcernReviewAccessError,ConcernReviewConflictError,ConcernReviewInputError}=loadTs("src/lib/credential-concerns/credential-concern-review-service.ts");
const {PublicVerificationService}=loadTs("src/lib/public-verification/public-verification-service.ts");
const {PublicVerificationRepository}=loadTs("src/lib/public-verification/public-verification-repository.ts");
const SECRET="concern-review-public-capability-secret-more-than-32";
const FINGERPRINT="c".repeat(64);
const id=(prefix,value)=>prefix+"_"+createHash("sha256").update(value).digest("hex").slice(0,24);
async function fixture(){
 const f=await credentialDecisionFixture();
 await f.repo.saveDecisionAndProgressCase(f.decision,"admin_credential_issuer");
 await applyMigrationsThrough(f.database,"concern-review-test",(await listMigrations()).at(-1).id);
 const credential=(await f.database.query("SELECT credential_id FROM credential_issuances")).rows[0].credential_id;
 const principal={accountId:"concern_admin_account",sessionId:"concern_admin_session",activeRole:"admin",accountStatus:"active",tenantMembership:null};
 await f.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,email_verified_at) VALUES($1,'concern-admin@example.test','Concern admin','active',CURRENT_TIMESTAMP)",[principal.accountId]);
 await f.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[principal.accountId]);
 await f.database.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,expires_at) VALUES($1,$2,'admin',$3,$3,CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP+INTERVAL '1 hour')",[principal.sessionId,principal.accountId,"a".repeat(64)]);
 const publicService=new PublicVerificationService(new PublicVerificationRepository(f.database),SECRET,[f.signingSecret]);
 const lookup=await publicService.lookupPublicVerification({rawIdentifier:credential,requestFingerprint:FINGERPRINT});assert.equal(lookup.kind,"redirect");
 const intake=await publicService.submitPublicVerificationConcern({publicToken:lookup.publicToken,requestFingerprint:FINGERPRINT,category:"document_concern",description:"This document needs independent checks before further reliance.",contactEmail:"reporter@example.test",idempotencyNonce:"concern_nonce_"+"r".repeat(24),subjectBinding:{kind:"credential",identifier:"credential_id_FORGED"},workerId:"FORGED"});
 assert.equal(intake.kind,"accepted");
 return {...f,credential,principal,concernId:intake.concernReference,publicService};
}
const reviewInput=(concernId,version=0,seed="first")=>({concernId,expectedVersion:version,requestId:id("concern_review",seed),outcome:"follow_up_needed",reason:"The original report requires further independent checks.",methods:"Checked the linked original credential and submitted report.",limitations:"The reported claim is not yet independently established."});
test("Real signed credential capability intake binds the trusted subject; legacy hash-only stays visibly unlinked",async()=>{
 const f=await fixture();try{
 const service=new CredentialConcernReviewService(f.database),record=await service.get(f.principal,f.concernId);
 assert.deepEqual(record.subject,{kind:"credential",identifier:f.credential,workerReference:"worker_id_validity_000001"});
 assert.equal(record.reviews.length,0);
 const queue=await service.list(f.principal);assert.equal(queue.items[0].concernId,f.concernId);assert.equal(queue.items[0].linked,true);
 const legacy=await new PublicVerificationRepository(f.database).createConcernWithAudit({concernId:id("public_concern","legacy"),subjectReferenceHash:"a".repeat(64),category:"other",description:"Legacy intake retains its exact report.",contactName:null,contactEmail:"legacy@example.test",contactPhone:null,idempotencyKey:"b".repeat(64),requestFingerprintHash:FINGERPRINT});
 assert.equal((await service.get(f.principal,legacy.concernId)).subject,null);
 const retry=await new PublicVerificationRepository(f.database).createConcernWithAudit({concernId:id("public_concern","legacy-retry"),subjectReferenceHash:"a".repeat(64),subjectBinding:{kind:"credential",identifier:f.credential},category:"other",description:"Legacy intake retains its exact report.",contactName:null,contactEmail:"legacy@example.test",contactPhone:null,idempotencyKey:"b".repeat(64),requestFingerprintHash:FINGERPRINT});
 assert.equal(retry.created,false);assert.equal((await service.get(f.principal,legacy.concernId)).subject,null);
 }finally{await f.database.close();}
});
test("Reasoned Admin review and amendments retain immutable history, enforce CAS and exact idempotency, never change intake or credential",async()=>{
 const f=await fixture();try{
 const service=new CredentialConcernReviewService(f.database),input=reviewInput(f.concernId);
 const before=(await f.database.query("SELECT * FROM public_verification_concerns WHERE concern_id=$1",[f.concernId])).rows[0];
 const credentialBefore=(await f.database.query("SELECT * FROM credential_issuances WHERE credential_id=$1",[f.credential])).rows[0];
 const first=await service.review(f.principal,input);assert.equal(first.reviews.length,1);assert.equal(first.reviews[0].version,1);
 assert.equal((await service.review(f.principal,input)).reviews.length,1);
 await assert.rejects(service.review(f.principal,{...input,reason:"Modified retry cannot replace retained review."}),ConcernReviewConflictError);
 const concurrent=await Promise.allSettled(["a","b"].map(seed=>service.review(f.principal,reviewInput(f.concernId,1,seed))));
 assert.equal(concurrent.filter(x=>x.status==="fulfilled").length,1);assert.equal(concurrent.filter(x=>x.status==="rejected"&&x.reason instanceof ConcernReviewConflictError).length,1);
 assert.equal((await service.get(f.principal,f.concernId)).reviews.length,2);
 assert.deepEqual((await f.database.query("SELECT * FROM public_verification_concerns WHERE concern_id=$1",[f.concernId])).rows[0],before);
 assert.deepEqual((await f.database.query("SELECT * FROM credential_issuances WHERE credential_id=$1",[f.credential])).rows[0],credentialBefore);
 assert.equal(Number((await f.database.query("SELECT count(*) AS count FROM platform_audit_events WHERE action_key='public_verification.concern.reviewed'")).rows[0].count),2);
 for(const table of ["public_verification_concern_reviews","public_verification_concern_subjects"]){
 await assert.rejects(f.database.query("DELETE FROM "+table+" WHERE concern_id=$1",[f.concernId]),/immutable/);
 await assert.rejects(f.database.query("UPDATE "+table+" SET concern_id=concern_id WHERE concern_id=$1",[f.concernId]),/immutable/);
 }
 await assert.rejects(f.database.execute(await readFile("database/migrations/0110_credential_concern_review.down.sql","utf8")),/must be retained/);
 assert.equal((await service.get(f.principal,f.concernId)).reviews.length,2);
 }finally{await f.database.close();}
});
test("All foreign roles, revoked, expired, disabled and demoted Admin sessions deny reads, resolution and private evidence before effects",async()=>{
 const f=await fixture();try{
 const service=new CredentialConcernReviewService(f.database);
 async function denied(principal){
 await assert.rejects(service.list(principal),ConcernReviewAccessError);
 await assert.rejects(service.get(principal,f.concernId),ConcernReviewAccessError);
 await assert.rejects(service.review(principal,reviewInput(f.concernId)),ConcernReviewAccessError);
 await assert.rejects(service.readEvidence(principal,f.concernId,id("secure_file","none")),ConcernReviewAccessError);
 }
 for(const role of ["worker","company","verifier","assessor","root"])await denied({...f.principal,activeRole:role});
 for(const [sql,undo] of [
 ["UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='test' WHERE session_id=$1","UPDATE auth_sessions SET revoked_at=NULL,revocation_reason=NULL WHERE session_id=$1"],
 ["UPDATE auth_sessions SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE session_id=$1","UPDATE auth_sessions SET expires_at=CURRENT_TIMESTAMP+INTERVAL '1 hour' WHERE session_id=$1"]
 ]){await f.database.query(sql,[f.principal.sessionId]);await denied(f.principal);await f.database.query(undo,[f.principal.sessionId]);}
 await f.database.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1",[f.principal.accountId]);await denied(f.principal);
 await f.database.query("UPDATE auth_accounts SET account_status='active' WHERE account_id=$1",[f.principal.accountId]);
 await f.database.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='admin'",[f.principal.accountId]);await denied(f.principal);
 assert.equal(Number((await f.database.query("SELECT count(*) AS count FROM public_verification_concern_reviews")).rows[0].count),0);
 }finally{await f.database.close();}
});
test("Invalid reviews and central audit failure roll back all resolution effects",async()=>{
 const f=await fixture();try{
 const service=new CredentialConcernReviewService(f.database),input=reviewInput(f.concernId);
 for(const patch of [{reason:"short"},{outcome:"fraud_confirmed"},{methods:""},{limitations:""},{expectedVersion:-1}])await assert.rejects(service.review(f.principal,{...input,...patch}),ConcernReviewInputError);
 await f.database.execute("CREATE FUNCTION fail_concern_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='public_verification.concern.reviewed' THEN RAISE EXCEPTION 'forced audit rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_concern_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION fail_concern_audit();");
 await assert.rejects(service.review(f.principal,input),/forced audit rollback/);
 assert.equal((await service.get(f.principal,f.concernId)).reviews.length,0);
 }finally{await f.database.close();}
});

async function evidenceFixture(f,marker="") {
 const directory=await mkdtemp(join(tmpdir(),"hse-concern-evidence-"));
 const {FilesystemPrivateObjectStorage}=loadTs("src/lib/secure-files/private-object-storage.ts");
 const {PublicConcernFileService}=loadTs("src/lib/public-verification/public-concern-file-service.ts");
 const {DatabaseOutboxRepository}=loadTs("src/lib/outbox/outbox-repository.ts");
 const {createTrustedOutboxWorker}=loadTs("src/lib/outbox/outbox-domain.ts");
 const {DatabaseSecureFileScanRepository}=loadTs("src/lib/secure-files/secure-file-scan-repository.ts");
 const {createLocalTestMalwareScanner}=loadTs("src/lib/secure-files/malware-scanner.ts");
 const storage=new FilesystemPrivateObjectStorage({trustedBasePath:directory,rootPath:join(directory,"objects")});
 const files=new PublicConcernFileService(new PublicVerificationRepository(f.database),storage);
 const bytes=Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n"+marker+"\n%%EOF\n");
 const result=await files.uploadConcernEvidence({authority:await files.authorizeConcernUpload(f.concernId),requestFingerprint:FINGERPRINT,idempotencyNonce:"concern_nonce_"+"e".repeat(24),originalFilename:"proof.pdf",declaredMime:"application/pdf",bytes});
 assert.equal(result.status,"pending");
 const fileId=(await f.database.query("SELECT secure_file_id FROM public_verification_concern_evidence_candidates WHERE candidate_id=$1",[result.candidateReference])).rows[0].secure_file_id;
 async function scan(){
 const outbox=new DatabaseOutboxRepository(Promise.resolve(f.database));let claimed;
 for(let i=0;i<10;i++){claimed=await outbox.claimNext(createTrustedOutboxWorker());assert(claimed);if(claimed.job.jobType==="secure_file.scan")break;}
 assert.equal(claimed.job.jobType,"secure_file.scan");
 const scannerResult=await createLocalTestMalwareScanner("test").scan(bytes,{fileRef:fileId,generation:1,attemptNumber:claimed.lease.attemptNumber});
 if(scannerResult.kind==="terminal"){await outbox.terminalFail(claimed.lease,scannerResult);return;}
 const scanRepository=new DatabaseSecureFileScanRepository(Promise.resolve(f.database));
 const current=await scanRepository.loadForHandler(claimed.job,claimed.lease);assert.equal(current.lifecycleStatus,"scan_pending");
 await scanRepository.finalizeDecision({job:claimed.job,lease:claimed.lease,finalStatus:scannerResult.kind==="clean"?"available":"unsafe",resultCode:scannerResult.code});
 await outbox.succeed(claimed.lease);
 }
 return {storage,bytes,fileId,scan,cleanup:()=>rm(directory,{recursive:true,force:true})};
}
test("Exact concern-bound evidence remains unavailable until its real scan finalizes; wrong concern and integrity mismatch deny bytes",async()=>{
 const f=await fixture(),e=await evidenceFixture(f);try{
 const service=new CredentialConcernReviewService(f.database,e.storage);
 await assert.rejects(service.readEvidence(f.principal,f.concernId,e.fileId),ConcernReviewAccessError);
 await e.scan();assert.equal((await service.get(f.principal,f.concernId)).evidence[0].available,true);
 assert.deepEqual(Buffer.from((await service.readEvidence(f.principal,f.concernId,e.fileId)).bytes),e.bytes);
 await assert.rejects(service.readEvidence(f.principal,id("public_concern","wrong"),e.fileId),ConcernReviewAccessError);
 const bad=new CredentialConcernReviewService(f.database,{read:async()=>new Uint8Array([1])});
 await assert.rejects(bad.readEvidence(f.principal,f.concernId,e.fileId),ConcernReviewAccessError);
 assert.equal(Number((await f.database.query("SELECT count(*) AS count FROM platform_audit_events WHERE action_key='public_verification.concern.evidence.served'")).rows[0].count),1);
 }finally{await e.cleanup();await f.database.close();}
});
test("Admin session that expires during private object I/O denies returned bytes and serving audit",async()=>{
 const f=await fixture(),e=await evidenceFixture(f);try{
 await e.scan();
 await f.database.query("UPDATE auth_sessions SET expires_at=clock_timestamp()+INTERVAL '250 milliseconds' WHERE session_id=$1",[f.principal.sessionId]);
 const delayedStorage={read:async key=>{await new Promise(resolve=>setTimeout(resolve,350));return e.storage.read(key);}};
 const service=new CredentialConcernReviewService(f.database,delayedStorage);
 await assert.rejects(service.readEvidence(f.principal,f.concernId,e.fileId),ConcernReviewAccessError);
 assert.equal(Number((await f.database.query("SELECT count(*) AS count FROM platform_audit_events WHERE action_key='public_verification.concern.evidence.served'")).rows[0].count),0);
 }finally{await e.cleanup();await f.database.close();}
});
test("An empty concern review rollback restores its exact prior audit constraint and safely reapplies",async()=>{
 const f=await credentialDecisionFixture();try{
 await applyMigrationsThrough(f.database,"concern-review-rollback","0103_question_approval_lifecycle");
 const query="SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check'";
 const original=(await f.database.query(query)).rows[0].definition;
 const up=await readFile("database/migrations/0110_credential_concern_review.up.sql","utf8"),down=await readFile("database/migrations/0110_credential_concern_review.down.sql","utf8");
 await f.database.transaction(tx=>tx.execute(up));await f.database.transaction(tx=>tx.execute(down));
 assert.equal((await f.database.query(query)).rows[0].definition,original);
 await f.database.transaction(tx=>tx.execute(up));
 assert((await f.database.query("SELECT to_regclass('public_verification_concern_reviews') AS table_name")).rows[0].table_name);
 }finally{await f.database.close();}
});

test("Unsafe and terminally failed concern evidence stay retained and unavailable to an authorized Admin",async()=>{
 for(const [marker,status] of [["EICAR-STANDARD-ANTIVIRUS-TEST-FILE","unsafe"],["HSE_VERIFY_SCAN_TERMINAL","scan_failed"]]){
 const f=await fixture(),e=await evidenceFixture(f,marker);try{
 await e.scan();const service=new CredentialConcernReviewService(f.database,e.storage),detail=await service.get(f.principal,f.concernId);
 assert.equal(detail.evidence[0].status,status);assert.equal(detail.evidence[0].available,false);
 assert.equal((await f.database.query("SELECT candidate_status FROM public_verification_concern_evidence_candidates WHERE secure_file_id=$1",[e.fileId])).rows[0].candidate_status,"rejected");
 await assert.rejects(service.readEvidence(f.principal,f.concernId,e.fileId),ConcernReviewAccessError);
 assert.equal(Number((await f.database.query("SELECT count(*) AS count FROM platform_audit_events WHERE action_key='public_verification.concern.evidence.served'")).rows[0].count),0);
 }finally{await e.cleanup();await f.database.close();}
 }
});
test("Available concern evidence rechecks foreign and revoked Admin authorization before private storage access",async()=>{
 const f=await fixture(),e=await evidenceFixture(f);try{
 await e.scan();let reads=0;
 const service=new CredentialConcernReviewService(f.database,{read:async key=>{reads++;return e.storage.read(key);}});
 for(const role of ["worker","company","assessor","verifier","root"])await assert.rejects(service.readEvidence({...f.principal,activeRole:role},f.concernId,e.fileId),ConcernReviewAccessError);
 await f.database.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='test' WHERE session_id=$1",[f.principal.sessionId]);
 await assert.rejects(service.readEvidence(f.principal,f.concernId,e.fileId),ConcernReviewAccessError);assert.equal(reads,0);
 }finally{await e.cleanup();await f.database.close();}
});
