import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "notification-foundation-test",
  sessionSecret: "notification-foundation-session-secret-32-characters",
  authPepper: "notification-foundation-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function opaque(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

function extractSql(source, name) {
  const prefix = `export const ${name} = \``;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${name} must be extractable`);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  assert.notEqual(end, -1, `${name} SQL terminator must be extractable`);
  return source.slice(contentStart, end);
}

async function contracts() {
  const source = await readFile(
    resolve("src/lib/notifications/notification-repository.ts"),
    "utf8"
  );
  return {
    insert: extractSql(source, "NOTIFICATION_INSERT_SQL"),
    findProjection: extractSql(source, "NOTIFICATION_FIND_PROJECTION_SQL"),
    sessionGuard: extractSql(source, "NOTIFICATION_SESSION_GUARD_SQL"),
    companyGuard: extractSql(source, "NOTIFICATION_COMPANY_SCOPE_GUARD_SQL"),
    list: extractSql(source, "NOTIFICATION_LIST_SQL"),
    unread: extractSql(source, "NOTIFICATION_UNREAD_COUNT_SQL"),
    find: extractSql(source, "NOTIFICATION_FIND_SQL"),
    markRead: extractSql(source, "NOTIFICATION_MARK_READ_SQL")
  };
}

async function insertActiveAccount(database, suffix, role) {
  const accountId = `account_notification_${suffix}`;
  const now = "2026-08-07T08:00:00.000Z";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `${suffix}@example.com`, `Notification ${suffix}`, now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, $2, $3)`,
    [accountId, role, now]
  );
  return { accountId, now };
}

async function insertSession(database, accountId, role, suffix, now) {
  const sessionId = `session_notification_${suffix}`;
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [
      sessionId,
      accountId,
      role,
      `token-hash-${suffix}`,
      `csrf-hash-${suffix}`,
      now,
      "2099-01-01T00:00:00.000Z"
    ]
  );
  return sessionId;
}

async function insertCompanyScope(database, accountId, suffix, now) {
  const tenantId = opaque("tenant", suffix);
  const membershipId = opaque("membership", suffix);
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
    [tenantId, `Tenant ${suffix}`, accountId, now]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, now]
  );
  return { tenantId, membershipId };
}

async function insertCompanionOwner(
  database,
  scope,
  createdByAccountId,
  suffix,
  now
) {
  const accountId = `account_notification_companion_${suffix}`;
  const membershipId = opaque("membership", suffix);
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [
      accountId,
      `notification-companion-${suffix.toLowerCase()}@example.com`,
      `Notification Companion ${suffix}`,
      now
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, now]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $5, $5, $5)`,
    [membershipId, scope.tenantId, accountId, createdByAccountId, now]
  );
}

async function insertJob(database, input) {
  const jobId = opaque("job", input.character);
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, $2, 1, $3, $4::jsonb, $5, $6, $7, $8)`,
    [
      jobId,
      input.jobType ?? "notification.portal.foundation",
      input.character.toLowerCase().repeat(64),
      JSON.stringify(input.payload ?? { fixtureRef: `fixture_${input.character}` }),
      input.accountId,
      input.role,
      input.tenantId ?? null,
      input.membershipId ?? null
    ]
  );
  return jobId;
}

async function insertNotification(database, sql, input) {
  return database.query(sql, [
    opaque("notification", input.character),
    "platform.foundation.ready",
    1,
    input.jobId,
    input.character.toLowerCase().repeat(64),
    input.accountId,
    input.role,
    input.tenantId ?? null,
    input.membershipId ?? null,
    "Notification foundation ready",
    "This persisted notification verifies the current portal notification channel.",
    JSON.stringify(input.payload ?? { fixtureRef: `fixture_${input.character}` }),
    "portal.dashboard",
    null
  ]);
}


import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const load=path=>loadTs(resolve(path));
const {markAllNotificationsReadForPrincipal}=load('src/lib/notifications/notification-read-service.ts');
const {DatabaseNotificationRepository}=load('src/lib/notifications/notification-repository.ts');
async function fixture(role='worker'){
 const db=await openScriptDatabase(ENVIRONMENT);await applyPendingMigrations(db,ENVIRONMENT.releaseSha);
 const account=await insertActiveAccount(db,'bulkread',role),sessionId=await insertSession(db,account.accountId,role,'bulkread',account.now);
 const scope=role==='company'?await insertCompanyScope(db,account.accountId,'A',account.now):null;
 const principal={sessionId,accountId:account.accountId,activeRole:role,accountStatus:'active',tenantMembership:scope?{...scope,status:'active',tenantStatus:'active',role:'owner'}:null};
 const sql=await contracts();
 async function notice(character,p=principal){const jobId=await insertJob(db,{character,accountId:p.accountId,role:p.activeRole,tenantId:p.tenantMembership?.tenantId,membershipId:p.tenantMembership?.membershipId});const result=await insertNotification(db,sql.insert,{character,jobId,accountId:p.accountId,role:p.activeRole,tenantId:p.tenantMembership?.tenantId,membershipId:p.tenantMembership?.membershipId});return result.rows[0].notification_id;}
 return {db,principal,notice};
}
const audits=db=>db.query("SELECT actor_account_id,actor_role,actor_tenant_id,target_reference,metadata FROM platform_audit_events WHERE action_key='notification.read' ORDER BY audit_sequence");
test('Bulk read affects only owned current-role unread rows, retains first read date and repeats idempotently',async()=>{
 const f=await fixture();try{
 const ids=[];for(const c of ['A','B','C'])ids.push(await f.notice(c));
 const repo=new DatabaseNotificationRepository(Promise.resolve(f.db));await repo.markReadForPrincipal(f.principal,ids[2]);const original=(await f.db.query('SELECT read_at FROM platform_notifications WHERE notification_id=$1',[ids[2]])).rows[0].read_at;
 const foreign=await insertActiveAccount(f.db,'foreignbulk','worker');await f.notice('D',{...f.principal,accountId:foreign.accountId});
 await f.db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[f.principal.accountId]);await f.notice('E',{...f.principal,activeRole:'admin'});
 assert.equal(await markAllNotificationsReadForPrincipal(f.db,f.principal),2);assert.equal(await repo.unreadCountForPrincipal(f.principal),0);
 assert.equal((await f.db.query('SELECT read_at FROM platform_notifications WHERE notification_id=$1',[ids[2]])).rows[0].read_at.toISOString(),original.toISOString());
 const a=(await audits(f.db)).rows;assert.equal(a.length,2);assert.ok(a.every(x=>x.actor_account_id===f.principal.accountId&&x.actor_role==='worker'));
 assert.equal((await f.db.query('SELECT count(*)::int n FROM platform_notifications WHERE read_at IS NULL')).rows[0].n,2);
 assert.equal(await markAllNotificationsReadForPrincipal(f.db,f.principal),0);assert.deepEqual((await audits(f.db)).rows,a);
 }finally{await f.db.close();}
});
test('Required audit failure rolls back the whole bulk update; retry records each changed row once',async()=>{
 const f=await fixture();try{
 await f.notice('A');const rejected=await f.notice('B');
 await f.db.execute(`CREATE FUNCTION reject_bulk_read_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='notification.read' AND NEW.target_reference='${rejected}' THEN RAISE EXCEPTION 'bulk read audit unavailable'; END IF; RETURN NEW; END; $$;CREATE TRIGGER reject_bulk_read_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION reject_bulk_read_audit();`);
 await assert.rejects(markAllNotificationsReadForPrincipal(f.db,f.principal),/bulk read audit unavailable/);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM platform_notifications WHERE read_at IS NULL')).rows[0].n,2);assert.equal((await audits(f.db)).rows.length,0);
 await f.db.execute('DROP TRIGGER reject_bulk_read_audit ON platform_audit_events');assert.equal(await markAllNotificationsReadForPrincipal(f.db,f.principal),2);assert.equal((await audits(f.db)).rows.length,2);
 }finally{await f.db.close();}
});
test('Revoked, locked, expired and wrong-role sessions cannot bulk read or add audit',async()=>{
 const f=await fixture();try{await f.notice('A');
 for(const sql of ["UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='fixture-revocation' WHERE session_id=$1","UPDATE auth_sessions SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE session_id=$1"]){await f.db.query(sql,[f.principal.sessionId]);await assert.rejects(markAllNotificationsReadForPrincipal(f.db,f.principal),/could not be accessed/);await f.db.query("UPDATE auth_sessions SET revoked_at=NULL,revocation_reason=NULL,expires_at='2099-01-01' WHERE session_id=$1",[f.principal.sessionId]);}
 await f.db.query("UPDATE auth_accounts SET account_status='locked',locked_until=CURRENT_TIMESTAMP+INTERVAL '10 minutes' WHERE account_id=$1",[f.principal.accountId]);await assert.rejects(markAllNotificationsReadForPrincipal(f.db,f.principal),/could not be accessed/);await f.db.query("UPDATE auth_accounts SET account_status='active',locked_until=NULL WHERE account_id=$1",[f.principal.accountId]);
 await assert.rejects(markAllNotificationsReadForPrincipal(f.db,{...f.principal,activeRole:'admin'}),/could not be accessed/);assert.equal((await audits(f.db)).rows.length,0);assert.equal((await f.db.query('SELECT read_at FROM platform_notifications')).rows[0].read_at,null);
 }finally{await f.db.close();}
});
test('Company bulk read is confined to exact current membership; revoked membership denies and other tenant history stays unread',async()=>{
 const f=await fixture('company');try{
 const own=await f.notice('A');const otherOwner=await insertActiveAccount(f.db,'foreigncompanybulk','company');const other=await insertCompanyScope(f.db,otherOwner.accountId,'B',otherOwner.now);const foreign=await f.notice('B',{...f.principal,accountId:otherOwner.accountId,tenantMembership:{...other,status:'active',tenantStatus:'active',role:'owner'}});await assert.rejects(markAllNotificationsReadForPrincipal(f.db,{...f.principal,tenantMembership:{...other,status:'active',tenantStatus:'active',role:'owner'}}),/could not be accessed/);
 assert.equal(await markAllNotificationsReadForPrincipal(f.db,f.principal),1);const rows=(await f.db.query('SELECT notification_id,read_at FROM platform_notifications ORDER BY notification_sequence')).rows;assert.ok(rows.find(x=>x.notification_id===own).read_at);assert.equal(rows.find(x=>x.notification_id===foreign).read_at,null);
 assert.equal((await audits(f.db)).rows[0].actor_tenant_id,f.principal.tenantMembership.tenantId);
 await insertCompanionOwner(f.db,f.principal.tenantMembership,f.principal.accountId,'C','2026-08-07T08:00:00.000Z');
 await f.db.query("UPDATE auth_tenant_memberships SET membership_status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE membership_id=$1",[f.principal.tenantMembership.membershipId]);await assert.rejects(markAllNotificationsReadForPrincipal(f.db,f.principal),/could not be accessed/);
 }finally{await f.db.close();}
});

test('Pending Company owner can bulk-read only delivered security notices using existing scoped audit actor rules',async()=>{
 const f=await fixture('company');try{
  await f.db.query("UPDATE platform_tenants SET tenant_status='pending',activated_at=NULL WHERE tenant_id=$1",[f.principal.tenantMembership.tenantId]);
  const pending={...f.principal,tenantMembership:{...f.principal.tenantMembership,tenantStatus:'pending'}};
  await f.db.query("INSERT INTO auth_security_events(event_id,account_id,event_type,active_role,metadata,occurred_at) VALUES('event_bulk_pending_password',$1,'password_changed','company','{}'::jsonb,CURRENT_TIMESTAMP)",[f.principal.accountId]);
  const {DatabaseOutboxRepository}=loadWorkerRegistrationTs('src/lib/outbox/outbox-repository.ts');const {processNextOutboxJob}=loadWorkerRegistrationTs('src/lib/outbox/outbox-worker.ts');
  const worked=await processNextOutboxJob({repository:new DatabaseOutboxRepository(Promise.resolve(f.db)),database:f.db});assert.equal(worked.status,'succeeded');
  assert.equal(await markAllNotificationsReadForPrincipal(f.db,pending),1);assert.equal(await markAllNotificationsReadForPrincipal(f.db,pending),0);
  const a=(await audits(f.db)).rows;assert.equal(a.length,1);assert.equal(a[0].actor_tenant_id,pending.tenantMembership.tenantId);assert.equal(a[0].metadata.notificationType,'account.password.changed');
 }finally{await f.db.close();}
});
