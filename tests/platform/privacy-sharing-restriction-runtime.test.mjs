import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../../tests/helpers/migration-ceiling.mjs";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "privacy-consent-accommodation-runtime",
  sessionSecret: "privacy-consent-accommodation-session-secret-more-than-32-characters",
  authPepper: "privacy-consent-accommodation-auth-pepper-more-than-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const NOW = "2026-10-01T00:00:00.123Z";

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(
    db,
    ENV.releaseSha,
    "0087_recovery_otp_delivery"
  );
  return db;
}

import { loadTs as realTs } from "../../scripts/interview-test-ts-loader.mjs";
const {PrivacyOperationsRepository}=realTs("src/lib/privacy/privacy-operations-repository.ts");
test("Masterplan restriction request can reach specific operative fulfilment",async()=>{
 const db=await database();
 try {
  for(const [id,role,ref] of [['restriction_worker','worker','restriction_worker_ref'],['restriction_admin','admin',null],['restriction_other','worker','restriction_other_ref']]){
   await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,worker_reference,created_at,updated_at) VALUES($1,$2,$1,'active','fixture',$3,$3,$4,$3,$3)",[id,id+'@example.test',NOW,ref]);
   await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[id,role,NOW]);
  }
  for(const [id,owner] of [['restriction_owned_link','restriction_worker_ref'],['restriction_foreign_link','restriction_other_ref']])await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES($1,$2,'[]'::jsonb,'Optional privacy sharing',$3,$4)",[id,owner,NOW,'n'.repeat(64)]);
  const repository=new PrivacyOperationsRepository(Promise.resolve(db));
  await repository.createRequest({requestId:'restriction_requested',workerId:'restriction_worker',tenantId:null,type:'restriction',details:{purpose:'optional_sharing'}});
  const result=await repository.reviewRequest({requestId:'restriction_requested',reviewerAccountId:'restriction_admin',reviewId:'restriction_review',expectedStatus:'OPEN',decision:'COMPLETED',reason:'Restrict future optional sharing while preserving required evidence and historical audit.',now:'2026-10-01T00:10:00.000Z'});
  assert.equal(result.status,'COMPLETED');
  const links=(await db.query('SELECT share_link_id,revoked_at FROM scoped_share_links ORDER BY share_link_id')).rows;
  assert.ok(links.find(row=>row.share_link_id==='restriction_owned_link').revoked_at);
  assert.equal(links.find(row=>row.share_link_id==='restriction_foreign_link').revoked_at,null);
  const {ScopedShareLinkRepository}=realTs('src/lib/share-links/scoped-share-link-repository.ts');
  const sharing=new ScopedShareLinkRepository(Promise.resolve(db));
  const record={shareLinkId:'restriction_new_link',ownerWorkerId:'restriction_worker_ref',fields:[],purpose:'Future optional sharing',employerDetail:null,createdAt:NOW,expiresAt:null,revokedAt:null,tokenNonceHash:'f'.repeat(64)};
  await assert.rejects(sharing.save(record),/restricted/i);
  await sharing.save({...record,shareLinkId:'restriction_other_new',ownerWorkerId:'restriction_other_ref'});
  assert.equal((await db.query("SELECT count(*)::int n FROM scoped_share_links WHERE share_link_id='restriction_new_link'")).rows[0].n,0);
  assert.equal((await db.query("SELECT count(*)::int n FROM privacy_request_reviews WHERE request_id='restriction_requested'")).rows[0].n,1);
 }finally{await db.close();}
});

async function seedRestrictionActors(db) {
 for(const [id,role,ref] of [['restriction_worker','worker','restriction_worker_ref'],['restriction_other','worker','restriction_other_ref'],['restriction_admin','admin',null]]) {
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,worker_reference,created_at,updated_at) VALUES($1,$2,$1,'active','fixture',$3,$3,$4,$3,$3)",[id,id+'@example.test',NOW,ref]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[id,role,NOW]);
 }
}
const decision={requestId:'restriction_requested',reviewerAccountId:'restriction_admin',reviewId:'restriction_review',expectedStatus:'OPEN',decision:'COMPLETED',reason:'Restrict future optional sharing while retaining required evidence.',now:'2026-10-01T00:10:00.000Z'};

test('Restriction denies valid recipient access even if a link is mistakenly restored; invalid tokens remain invalid',async()=>{
 const db=await database();try {
 await seedRestrictionActors(db);
 const {ScopedShareLinkRepository}=realTs('src/lib/share-links/scoped-share-link-repository.ts');
 const {ScopedShareLinkService}=realTs('src/lib/share-links/scoped-share-link-service.ts');
 const {ScopedShareLinkManager}=realTs('src/lib/share-links/scoped-share-link-domain.ts');
 const repository=new ScopedShareLinkRepository(Promise.resolve(db)),service=new ScopedShareLinkService(repository),key='restriction-signed-fixture-key-more-than32';
 service.manager=()=>new ScopedShareLinkManager(key);
 const links=[];for(const ownerWorkerId of ['restriction_worker_ref','restriction_other_ref'])links.push(await service.create({ownerWorkerId,fields:['worker_id'],purpose:'Actual optional sharing access',createdAt:NOW}));
 const privacy=new PrivacyOperationsRepository(Promise.resolve(db));
 await privacy.createRequest({requestId:decision.requestId,workerId:'restriction_worker',tenantId:null,type:'restriction',details:{purpose:'optional_sharing'}});await privacy.reviewRequest(decision);
 await db.query('UPDATE scoped_share_links SET revoked_at=NULL WHERE share_link_id=$1',[links[0].record.shareLinkId]);
 const resolve=link=>service.resolvePublic({token:link.token,shareLinkId:link.record.shareLinkId,accessedAt:decision.now});
 assert.deepEqual(await resolve(links[0]),{kind:'denied',reason:'revoked'});
 const before=(await repository.listLogs(links[0].record.shareLinkId)).length;
 assert.deepEqual(await service.resolvePublic({token:'forged',shareLinkId:links[0].record.shareLinkId,accessedAt:decision.now}),{kind:'denied',reason:'invalid'});
 assert.equal((await repository.listLogs(links[0].record.shareLinkId)).length,before);
 assert.equal((await resolve(links[1])).kind,'granted');
 await assert.rejects(service.create({ownerWorkerId:'restriction_worker_ref',fields:['worker_id'],purpose:'Cannot bypass through service',createdAt:decision.now}),/restricted/);
 }finally{await db.close();}
});

test('Required restriction review history failure rolls back revocation and sharing state; stale repeat cannot rewrite review',async()=>{
 const db=await database();try {
 await seedRestrictionActors(db);
 await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES('share_link_rollback','restriction_worker_ref','[]'::jsonb,'Rollback optional sharing',$1,$2)",[NOW,'n'.repeat(64)]);
 const privacy=new PrivacyOperationsRepository(Promise.resolve(db));await privacy.createRequest({requestId:decision.requestId,workerId:'restriction_worker',tenantId:null,type:'restriction',details:{purpose:'optional_sharing'}});
 await db.execute("CREATE FUNCTION reject_restriction_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected restriction review failure'; END; $$; CREATE TRIGGER reject_restriction_review BEFORE INSERT ON privacy_request_reviews FOR EACH ROW EXECUTE FUNCTION reject_restriction_review();");
 await assert.rejects(privacy.reviewRequest(decision),/injected restriction review failure/);
 assert.equal((await db.query("SELECT status,details FROM privacy_requests WHERE request_id=$1",[decision.requestId])).rows[0].status,'OPEN');
 assert.equal((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='share_link_rollback'")).rows[0].revoked_at,null);
 assert.equal((await db.query('SELECT count(*)::int n FROM privacy_request_reviews')).rows[0].n,0);
 await db.execute('DROP TRIGGER reject_restriction_review ON privacy_request_reviews; DROP FUNCTION reject_restriction_review();');
 await privacy.reviewRequest(decision);await assert.rejects(privacy.reviewRequest({...decision,reviewId:'restriction_repeated'}),/changed or is unavailable/);
 assert.equal((await db.query('SELECT count(*)::int n FROM privacy_request_reviews')).rows[0].n,1);
 }finally{await db.close();}
});

test('Forged or unsupported restriction scope cannot install sharing restrictions',async()=>{
 const db=await database();try {await seedRestrictionActors(db);const privacy=new PrivacyOperationsRepository(Promise.resolve(db));
 for(const details of [{purpose:'required_assessment'},{purpose:'optional_sharing',workerId:'restriction_other'},{purpose:'optional_sharing',fulfilment:{method:'optional_sharing_restriction'}}])await assert.rejects(privacy.createRequest({requestId:'forged_restriction',workerId:'restriction_worker',tenantId:null,type:'restriction',details}),/scope/);
 await privacy.createRequest({requestId:decision.requestId,workerId:'restriction_worker',tenantId:null,type:'restriction'});
 assert.deepEqual((await db.query("SELECT status,details FROM privacy_requests WHERE request_id=$1",[decision.requestId])).rows,[{status:'OPEN',details:{}}]);
 await assert.rejects(privacy.reviewRequest(decision),/supported fulfilment scope/);
 assert.equal((await db.query('SELECT count(*)::int n FROM privacy_request_reviews')).rows[0].n,0);
 }finally{await db.close();}
});

import { seedPermanentWorkerId } from "../helpers/permanent-worker-id-fixture.mjs";

test('Restriction covers reference and permanent ID aliases and refuses ambiguous ownership without affecting another Worker',async()=>{
 const db=await database();try {await seedRestrictionActors(db);
 const permanent=await seedPermanentWorkerId(db,{accountId:'restriction_worker'},'z');
 const {ScopedShareLinkRepository}=realTs('src/lib/share-links/scoped-share-link-repository.ts'),sharing=new ScopedShareLinkRepository(Promise.resolve(db));
 const record={shareLinkId:'share_link_aliasref',ownerWorkerId:'restriction_worker_ref',fields:['worker_id'],purpose:'Alias optional sharing',employerDetail:null,createdAt:NOW,expiresAt:null,revokedAt:null,tokenNonceHash:'n'.repeat(64)};
 await sharing.save(record);await sharing.save({...record,shareLinkId:'share_link_aliaspermanent',ownerWorkerId:permanent});
 const privacy=new PrivacyOperationsRepository(Promise.resolve(db));await privacy.createRequest({requestId:decision.requestId,workerId:'restriction_worker',tenantId:null,type:'restriction',details:{purpose:'optional_sharing'}});await privacy.reviewRequest(decision);
 assert.equal((await db.query('SELECT count(*)::int n FROM scoped_share_links WHERE revoked_at IS NOT NULL')).rows[0].n,2);
 for(const ownerWorkerId of ['restriction_worker_ref',permanent])await assert.rejects(sharing.save({...record,shareLinkId:'share_link_aliasdenied',ownerWorkerId}),/restricted/);
 await db.query("UPDATE auth_accounts SET worker_reference=$1 WHERE account_id='restriction_other'",[permanent]);
 await assert.rejects(sharing.save({...record,shareLinkId:'share_link_aliasambiguous',ownerWorkerId:permanent}),/ownership/);
 await privacy.createRequest({requestId:'restriction_ambiguous',workerId:'restriction_other',tenantId:null,type:'restriction',details:{purpose:'optional_sharing'}});
 await assert.rejects(privacy.reviewRequest({...decision,requestId:'restriction_ambiguous',reviewId:'restriction_ambiguous_review'}),/ownership/);
 assert.equal((await db.query("SELECT status FROM privacy_requests WHERE request_id='restriction_ambiguous'")).rows[0].status,'OPEN');
 }finally{await db.close();}
});

test('Executed restriction and sharing queries use account-first conflicting locks and fresh state inside access transaction',async()=>{
 const db=await database();try {await seedRestrictionActors(db);const traces=[];const original=db.transaction.bind(db);
 db.transaction=operation=>original(async tx=>{const statements=[];traces.push(statements);const query=tx.query.bind(tx);tx.query=(statement,parameters)=>{statements.push(statement);return query(statement,parameters);};return operation(tx);});
 const {ScopedShareLinkRepository}=realTs('src/lib/share-links/scoped-share-link-repository.ts'),sharing=new ScopedShareLinkRepository(Promise.resolve(db));
 const record={shareLinkId:'share_link_lockorder',ownerWorkerId:'restriction_worker_ref',fields:['worker_id'],purpose:'Lock order optional sharing',employerDetail:null,createdAt:NOW,expiresAt:null,revokedAt:null,tokenNonceHash:'n'.repeat(64)};
 await sharing.save(record);const creation=traces.at(-1);const createLock=creation.findIndex(sql=>sql.includes('FOR NO KEY UPDATE')),createWrite=creation.findIndex(sql=>sql.includes('INSERT INTO scoped_share_links'));assert.ok(createLock>=0 && createWrite>=0 && createLock<createWrite);
 const privacy=new PrivacyOperationsRepository(Promise.resolve(db));await privacy.createRequest({requestId:decision.requestId,workerId:'restriction_worker',tenantId:null,type:'restriction',details:{purpose:'optional_sharing'}});await privacy.reviewRequest(decision);
 const completion=traces.at(-1);const completeLock=completion.findIndex(sql=>sql.includes('FOR NO KEY UPDATE')),completeWrite=completion.findIndex(sql=>sql.includes('UPDATE scoped_share_links'));assert.ok(completeLock>=0 && completeWrite>=0 && completeLock<completeWrite);
 const restricted=await sharing.withSharingAccess(record.shareLinkId,async (repo,_tx,value)=>{assert.equal(value,true);await repo.saveAccessLog({shareLinkId:record.shareLinkId,accessedAt:decision.now,outcome:'denied',reason:'revoked'});return value;});assert.equal(restricted,true);
 const access=traces.at(-1),lock=access.findIndex(sql=>sql.includes('FOR SHARE')),state=access.findIndex(sql=>sql.includes("request_type='restriction'")),log=access.findIndex(sql=>sql.includes('INSERT INTO scoped_share_access_logs'));
 assert.ok(lock>=0 && state>lock && log>state);assert.equal(access.some(sql=>sql.includes('FOR KEY SHARE')),false);
 }finally{await db.close();}
});

test('Permanent Worker ID retains earlier owned links and permits direct revocation without granting foreign ownership',async()=>{
 const db=await database();try {await seedRestrictionActors(db);
 const {ScopedShareLinkRepository}=realTs('src/lib/share-links/scoped-share-link-repository.ts');
 const {ScopedShareLinkService}=realTs('src/lib/share-links/scoped-share-link-service.ts');
 const {ScopedShareLinkManager}=realTs('src/lib/share-links/scoped-share-link-domain.ts');
 const repository=new ScopedShareLinkRepository(Promise.resolve(db)), service=new ScopedShareLinkService(repository);
 service.manager=()=>new ScopedShareLinkManager('alias-sharing-test-signing-key-longer-than-thirty-two');
 const create=ownerWorkerId=>service.create({ownerWorkerId,fields:['worker_id'],purpose:'Retained alias ownership',createdAt:NOW});
 const earlier=await create('restriction_worker_ref'),foreign=await create('restriction_other_ref');
 const permanent=await seedPermanentWorkerId(db,{accountId:'restriction_worker'},'y');
 const later=await create(permanent);
 for(const owner of ['restriction_worker_ref',permanent])assert.deepEqual(new Set((await service.listOwned(owner)).map(row=>row.shareLinkId)),new Set([earlier.record.shareLinkId,later.record.shareLinkId]));
 assert.equal((await repository.findOwned(earlier.record.shareLinkId,permanent)).shareLinkId,earlier.record.shareLinkId);
 assert.equal(await repository.findOwned(foreign.record.shareLinkId,permanent),null);
 await assert.rejects(service.revoke({ownerWorkerId:permanent,shareLinkId:foreign.record.shareLinkId,revokedAt:decision.now}),/not found/);
 const revoked=await service.revoke({ownerWorkerId:permanent,shareLinkId:earlier.record.shareLinkId,revokedAt:decision.now});assert.equal(revoked.revokedAt,decision.now);
 const repeated=await service.revoke({ownerWorkerId:'restriction_worker_ref',shareLinkId:earlier.record.shareLinkId,revokedAt:'2026-10-01T00:20:00.000Z'});assert.equal(repeated.revokedAt,decision.now);
 assert.equal((await repository.find(foreign.record.shareLinkId)).revokedAt,null);
 assert.equal((await service.resolvePublic({token:earlier.token,shareLinkId:earlier.record.shareLinkId,accessedAt:decision.now})).reason,'revoked');
 await db.query("UPDATE auth_accounts SET worker_reference=$1 WHERE account_id='restriction_other'",[permanent]);
 await assert.rejects(service.listOwned(permanent),/ownership/);
 await assert.rejects(service.revoke({ownerWorkerId:permanent,shareLinkId:later.record.shareLinkId,revokedAt:decision.now}),/ownership/);
 assert.equal((await repository.find(later.record.shareLinkId)).revokedAt,null);
 }finally{await db.close();}
});
