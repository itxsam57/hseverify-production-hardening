import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { ConsentRecordService } = loadTs("src/lib/privacy/consent-record-service.ts");
const { PrivacyOperationsService } = loadTs("src/lib/privacy/privacy-operations-service.ts");
const { PrivacyOperationsRepository } = loadTs("src/lib/privacy/privacy-operations-repository.ts");
const { CaseAccommodationService } = loadTs("src/lib/privacy/case-accommodation-service.ts");

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
const NOW = "2026-10-01T00:00:00.000Z";
const oid = (prefix, c) => prefix + "_" + c.repeat(24);

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(
    db,
    ENV.releaseSha,
    "0078_privacy_request_review_history"
  );
  return db;
}

async function seedAccount(db, accountId, email, role) {
  await db.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, role + " privacy fixture", "scrypt$16384$8$1$salt$hash", NOW]
  );
  await db.query(
    "INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",
    [accountId, role, NOW]
  );
}

async function seedCase(db, suffix, workerId) {
  const tenantId = oid("tenant", suffix);
  const orderId = oid("assurance_order", suffix);
  const targetId = oid("assurance_target", suffix);
  const caseId = oid("assurance_case", suffix);
  const linkId = "worker_link_privacy_" + suffix.repeat(4);
  await db.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,order_status
     ) VALUES($1,$2,$3,$4,$5,'DRAFT')`,
    [orderId, tenantId, "membership_privacy_" + suffix.repeat(5), "Privacy order " + suffix, "PRIV-" + suffix]
  );
  await db.query(
    `INSERT INTO assurance_order_workers(
       target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status
     ) VALUES($1,$2,$3,$4,$5,'company','eligible')`,
    [targetId, orderId, tenantId, linkId, workerId]
  );
  await db.query(
    `INSERT INTO assurance_cases(
       case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
       case_status,owner_kind,next_action
     ) VALUES($1,$2,$3,$4,$5,$6,'Assessment pending','worker','Complete the assigned assessment.')`,
    [caseId, orderId, targetId, tenantId, linkId, workerId]
  );
  return { tenantId, orderId, targetId, caseId };
}

test("consent history is versioned, withdrawable only prospectively and append-only", async () => {
  const db = await database();
  try {
    const worker = "account_privacy_worker_01";
    await seedAccount(db, worker, "privacy-worker-01@example.test", "worker");
    const caseOne = await seedCase(db, "a", worker);
    const workerRef = oid("worker_id", "u");
    await db.query("UPDATE auth_accounts SET worker_reference=$2 WHERE account_id=$1", [worker,workerRef]);
    await db.query(
      "INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES($1,$2,$3::jsonb,$4,$5,$6)",
      ["share_test_01",workerRef,JSON.stringify(["workerId"]),"Optional selected passport sharing",NOW,"n".repeat(64)]
    );
    const service = new ConsentRecordService(Promise.resolve(db));

    const granted = await service.grant({
      workerId: worker,
      actorAccountId: worker,
      consentType: "scoped_share_links",
      purpose: "Share only the Worker-selected fields through one scoped link.",
      caseId: caseOne.caseId,
      withdrawalRule: "FUTURE_PROCESSING_ONLY",
      metadata: { shareLinkId: "share_test_01" },
      now: new Date(NOW)
    });
    const withdrawn = await service.withdraw({
      workerId: worker,
      actorAccountId: worker,
      consentId: granted.consentId,
      reason: "Stop future sharing through this consent.",
      now: new Date("2026-10-01T00:10:00.000Z")
    });
    assert.equal(granted.version, 1);
    assert.equal(withdrawn.version, 2);
    assert.equal(withdrawn.action, "WITHDRAWN");

    const history = await service.listWorkerHistory(worker);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((row) => row.action), ["WITHDRAWN", "GRANTED"]);

    await assert.rejects(
      db.query(
        "UPDATE privacy_consent_records SET purpose='tampered' WHERE consent_id=$1 AND version=1",
        [granted.consentId]
      ),
      /append-only/i
    );

    const required = await service.grant({
      workerId: worker,
      actorAccountId: worker,
      consentType: "interview_recording",
      purpose: "Required interview recording consent for the active assigned case.",
      caseId: caseOne.caseId,
      withdrawalRule: "NOT_WITHDRAWABLE_WHILE_REQUIRED",
      now: new Date(NOW)
    });
    await assert.rejects(
      service.withdraw({
        workerId: worker,
        actorAccountId: worker,
        consentId: required.consentId,
        reason: "Try to withdraw active required consent."
      }),
      /cannot be withdrawn/i
    );
  } finally {
    await db.close();
  }
});

test("canonical privacy request types persist through the real repository", async () => {
  const db = await database();
  try {
    const worker = "account_privacy_worker_02";
    await seedAccount(db, worker, "privacy-worker-02@example.test", "worker");
    const service = new PrivacyOperationsService(
      new PrivacyOperationsRepository(Promise.resolve(db))
    );
    for (const type of [
      "access",
      "correction",
      "restriction",
      "consent_withdrawal",
      "share_link_revocation",
      "retention_inquiry",
      "deletion",
      "export"
    ]) {
      await service.request({
        requestId: "request_" + type + "_02",
        tenantId: null,
        workerId: worker,
        type
      });
    }
    const listed = await service.listWorkerPrivacy(null, worker, worker);
    assert.deepEqual(
      new Set(listed.requests.map((row) => row.request_type)),
      new Set([
        "access",
        "correction",
        "restriction",
        "consent_withdrawal",
        "share_link_revocation",
        "retention_inquiry",
        "deletion",
        "export"
      ])
    );
  } finally {
    await db.close();
  }
});

test("approved accommodation binds only to the same Worker case and resolves as a delivery overlay", async () => {
  const db = await database();
  try {
    const worker = "account_privacy_worker_03";
    const otherWorker = "account_privacy_worker_04";
    const admin = "account_privacy_admin_01";
    await seedAccount(db, worker, "privacy-worker-03@example.test", "worker");
    await seedAccount(db, otherWorker, "privacy-worker-04@example.test", "worker");
    await seedAccount(db, admin, "privacy-admin-01@example.test", "admin");
    const workerCase = await seedCase(db, "b", worker);
    const otherCase = await seedCase(db, "c", otherWorker);

    const repository = new PrivacyOperationsRepository(Promise.resolve(db));
    const service = new PrivacyOperationsService(repository);
    await service.accommodation({
      id: "accommodation_worker_03",
      tenantId: null,
      workerId: worker,
      type: "extra time and captions"
    });

    await assert.rejects(
      service.reviewAccommodation({
        accommodationId: "accommodation_worker_03",
        reviewerAccountId: admin,
        decision: "APPROVED",
        reason: "This approval deliberately targets the wrong Worker case.",
        caseId: otherCase.caseId,
        adjustment: { timeMultiplier: 1.5, captions: true }
      }),
      /does not belong/i
    );

    const approved = await service.reviewAccommodation({
      accommodationId: "accommodation_worker_03",
      reviewerAccountId: admin,
      decision: "APPROVED",
      reason: "Approved delivery adjustment without changing competency standards.",
      caseId: workerCase.caseId,
      adjustment: {
        timeMultiplier: 1.5,
        extraBreakMinutes: 15,
        captions: true,
        screenReader: true
      },
      now: new Date("2026-10-01T01:00:00.000Z")
    });
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.case_id, workerCase.caseId);

    const resolved = await new CaseAccommodationService(Promise.resolve(db))
      .resolveForWorker(workerCase.caseId, worker);
    assert.equal(resolved.adjustment.timeMultiplier, 1.5);
    assert.equal(resolved.adjustment.extraBreakMinutes, 15);
    assert.equal(resolved.adjustment.captions, true);
    assert.equal(resolved.adjustment.screenReader, true);
    assert.deepEqual(resolved.accommodationIds, ["accommodation_worker_03"]);

    await assert.rejects(
      db.query(
        "UPDATE assurance_case_accommodation_overlays SET adjustment='{}'::jsonb WHERE case_id=$1",
        [workerCase.caseId]
      ),
      /append-only/i
    );

    await service.accommodation({
      id: "accommodation_worker_03_declined",
      tenantId: null,
      workerId: worker,
      type: "unrelated request"
    });
    const declined = await service.reviewAccommodation({
      accommodationId: "accommodation_worker_03_declined",
      reviewerAccountId: admin,
      decision: "DECLINED",
      reason: "Requested change is not required for accessible delivery."
    });
    assert.equal(declined.status, "DECLINED");
    const overlays = await repository.listCaseAccommodationOverlays(workerCase.caseId);
    assert.equal(overlays.length, 1);
  } finally {
    await db.close();
  }
});

test("privacy review rejects stale decisions, rolls back missing reviewers, and preserves immutable history", async () => {
  const db = await database();
  try {
    const worker = "account_privacy_review_worker";
    const admin = "account_privacy_review_admin";
    await seedAccount(db, worker, "privacy-review-worker@example.test", "worker");
    await seedAccount(db, admin, "privacy-review-admin@example.test", "admin");
    const service = new PrivacyOperationsService(new PrivacyOperationsRepository(Promise.resolve(db)));
    await service.request({ requestId: "privacy_request_review", workerId: worker, tenantId: null, type: "restriction" });
    const input = { requestId: "privacy_request_review", reviewerAccountId: admin, expectedStatus: "OPEN", decision: "PROCESSING", reason: "Reviewing the required processing purpose." };
    await assert.rejects(() => service.reviewRequest({ ...input, reason: "short" }), /reason/);
    await assert.rejects(() => service.reviewRequest({ ...input, reviewerAccountId: "missing-reviewer" }));
    assert.equal((await db.query("SELECT status FROM privacy_requests WHERE request_id=$1", [input.requestId])).rows[0].status, "OPEN");
    await service.reviewRequest(input);
    await assert.rejects(() => service.reviewRequest({ ...input, decision: "REJECTED" }), /changed|unavailable/);
    await service.reviewRequest({ ...input, expectedStatus: "PROCESSING", decision: "REJECTED", reason: "Required evidence is retained for the active assessment." });
    await assert.rejects(() => service.reviewRequest({ ...input, expectedStatus: "REJECTED" }), /changed|unavailable/);
    const history = await db.query("SELECT * FROM privacy_request_reviews WHERE request_id=$1 ORDER BY review_sequence", [input.requestId]);
    assert.deepEqual(history.rows.map(row => [row.from_status,row.to_status]), [["OPEN","PROCESSING"],["PROCESSING","REJECTED"]]);
    await assert.rejects(() => db.query("UPDATE privacy_request_reviews SET reason='Erase the prior review' WHERE request_id=$1", [input.requestId]), /append-only/);
    await assert.rejects(() => db.query("DELETE FROM privacy_request_reviews WHERE request_id=$1", [input.requestId]), /append-only/);
    const owned = await service.listWorkerPrivacy(null, worker, worker);
    assert.equal(owned.requests[0].review_reason, "Required evidence is retained for the active assessment.");
  } finally { await db.close(); }
});

test("scoped sharing withdrawal revokes only its owned link atomically and preserves other grants", async () => {
  const db = await database();
  try {
    const worker = "account_withdrawal_owner";
    const other = "account_withdrawal_other";
    const workerRef = oid("worker_id", "v");
    const otherRef = oid("worker_id", "w");
    await seedAccount(db, worker, "withdrawal-owner@example.test", "worker");
    await seedAccount(db, other, "withdrawal-other@example.test", "worker");
    await db.query("UPDATE auth_accounts SET worker_reference=$2 WHERE account_id=$1", [worker,workerRef]);
    await db.query("UPDATE auth_accounts SET worker_reference=$2 WHERE account_id=$1", [other,otherRef]);
    for (const [linkId,owner] of [["withdrawal-link-one",workerRef],["withdrawal-link-two",workerRef],["withdrawal-link-other",otherRef]]) {
      await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES($1,$2,'[\"workerId\"]'::jsonb,'Optional employer sharing',$3,$4)", [linkId,owner,NOW,"n".repeat(64)]);
    }
    const service = new ConsentRecordService(Promise.resolve(db));
    const grant = await service.grant({ workerId:worker,actorAccountId:worker,consentType:"scoped_share_links",purpose:"Optional sharing for onboarding.",metadata:{shareLinkId:"withdrawal-link-one"},now:new Date(NOW) });
    await assert.rejects(() => service.withdraw({workerId:worker,actorAccountId:worker,consentId:grant.consentId,reason:"Withdraw this optional employer link.",now:new Date("2026-09-30T00:00:00Z")}), /predate|unavailable/);
    const withdrawn = await service.withdraw({workerId:worker,actorAccountId:worker,consentId:grant.consentId,reason:"Withdraw this optional employer link.",now:new Date("2026-10-02T00:00:00Z")});
    assert.equal(withdrawn.action,"WITHDRAWN");
    const links = await db.query("SELECT share_link_id,revoked_at FROM scoped_share_links ORDER BY share_link_id");
    assert.ok(links.rows.find(row => row.share_link_id === "withdrawal-link-one").revoked_at);
    assert.equal(links.rows.find(row => row.share_link_id === "withdrawal-link-two").revoked_at,null);
    assert.equal(links.rows.find(row => row.share_link_id === "withdrawal-link-other").revoked_at,null);
    await service.withdraw({workerId:worker,actorAccountId:worker,consentId:grant.consentId,reason:"Repeat the same withdrawal safely."});
    assert.equal((await service.listWorkerHistory(worker)).filter(row => row.consentId === grant.consentId).length,2);
    const secondGrant = await service.grant({workerId:worker,actorAccountId:worker,consentType:"scoped_share_links",purpose:"Keep this independent sharing grant.",metadata:{shareLinkId:"withdrawal-link-two"}});
    await assert.rejects(() => service.withdraw({workerId:worker,actorAccountId:"missing-withdrawal-actor",consentId:secondGrant.consentId,reason:"Force a failed history append after link update."}));
    assert.equal((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='withdrawal-link-two'")).rows[0].revoked_at,null);
    assert.equal((await service.listWorkerHistory(worker)).filter(row => row.consentId === secondGrant.consentId).length,1);
    for (const metadata of [{shareLinkId:"withdrawal-link-other"},{shareLinkId:"missing-link"},{}]) {
      const invalid = await service.grant({ workerId:worker,actorAccountId:worker,consentType:"scoped_share_links",purpose:"Invalid linked sharing request.",metadata });
      await assert.rejects(() => service.withdraw({workerId:worker,actorAccountId:worker,consentId:invalid.consentId,reason:"Reject an unowned or missing shared link."}), /link|sharing/);
      assert.equal((await service.listWorkerHistory(worker)).filter(row => row.consentId === invalid.consentId).length,1);
    }
  } finally { await db.close(); }
});

test("historical withdrawn scoped consent reconciles owned access despite future link creation", async () => {
  const db = await database();
  try {
    const worker = "account_historical_withdrawal";
    const workerRef = oid("worker_id", "z");
    await seedAccount(db, worker, "historical-withdrawal@example.test", "worker");
    await db.query("UPDATE auth_accounts SET worker_reference=$2 WHERE account_id=$1", [worker,workerRef]);
    await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES('historical-link',$1,'[\"workerId\"]'::jsonb,'Historical sharing','2099-01-01',$2)", [workerRef,"n".repeat(64)]);
    const service = new ConsentRecordService(Promise.resolve(db));
    const granted = await service.grant({workerId:worker,actorAccountId:worker,consentType:"scoped_share_links",purpose:"Historical scoped sharing consent.",metadata:{shareLinkId:"historical-link"},now:new Date(NOW)});
    const input = {workerId:worker,actorAccountId:worker,consentId:granted.consentId,reason:"Immediately stop optional sharing.",now:new Date("2026-10-02T00:00:00Z")};
    const withdrawn = await service.withdraw(input);
    assert.equal(withdrawn.action,"WITHDRAWN");
    await db.query("UPDATE scoped_share_links SET revoked_at=NULL WHERE share_link_id='historical-link'");
    await service.withdraw(input);
    assert.ok((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='historical-link'")).rows[0].revoked_at);
    assert.equal((await service.listWorkerHistory(worker)).length,2);
  } finally { await db.close(); }
});
test("previously withdrawn scoped consent repairs still-active access", async () => {
  const db = await database();
  try {
    const worker = "account_historical_withdrawal";
    const workerRef = oid("worker_id", "z");
    await seedAccount(db, worker, "historical-withdrawal@example.test", "worker");
    await db.query("UPDATE auth_accounts SET worker_reference=$2 WHERE account_id=$1", [worker,workerRef]);
    await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES('historical-link',$1,'[\"workerId\"]'::jsonb,'Historical sharing','2026-10-01',$2)", [workerRef,"n".repeat(64)]);
    await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES('unowned-historical-link',$1,'[\"workerId\"]'::jsonb,'Unowned sharing','2026-10-01',$2),('unrelated-active-link',$3,'[\"workerId\"]'::jsonb,'Other active sharing','2026-10-01',$2)", [oid("worker_id","y"),"n".repeat(64),workerRef]);
    const service = new ConsentRecordService(Promise.resolve(db));
    const granted = await service.grant({workerId:worker,actorAccountId:worker,consentType:"scoped_share_links",purpose:"Historical scoped sharing consent.",metadata:{shareLinkId:"historical-link"},now:new Date(NOW)});
    const input = {workerId:worker,actorAccountId:worker,consentId:granted.consentId,reason:"Immediately stop optional sharing.",now:new Date("2026-10-02T00:00:00Z")};
    await db.query(`INSERT INTO privacy_consent_records(consent_id,version,worker_id,consent_type,purpose,actor_account_id,action,withdrawal_rule,metadata,recorded_at)
      SELECT consent_id,2,worker_id,consent_type,purpose,actor_account_id,'WITHDRAWN',withdrawal_rule,metadata,'2026-10-02'
      FROM privacy_consent_records WHERE consent_id=$1 AND version=1`, [granted.consentId]);
    const unowned = await service.grant({workerId:worker,actorAccountId:worker,consentType:"scoped_share_links",purpose:"Do not revoke another Worker link.",metadata:{shareLinkId:"unowned-historical-link"},now:new Date(NOW)});
    await db.query(`INSERT INTO privacy_consent_records(consent_id,version,worker_id,consent_type,purpose,actor_account_id,action,withdrawal_rule,metadata,recorded_at)
      SELECT consent_id,2,worker_id,consent_type,purpose,actor_account_id,'WITHDRAWN',withdrawal_rule,metadata,'2026-10-02'
      FROM privacy_consent_records WHERE consent_id=$1 AND version=1`, [unowned.consentId]);
    await db.execute(await readFile("database/migrations/0079_scoped_consent_withdrawal_reconciliation.up.sql", "utf8"));
    assert.ok((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='historical-link'")).rows[0].revoked_at);
    await db.execute(await readFile("database/migrations/0079_scoped_consent_withdrawal_reconciliation.up.sql", "utf8"));
    assert.equal((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='unowned-historical-link'")).rows[0].revoked_at,null);
    assert.equal((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='unrelated-active-link'")).rows[0].revoked_at,null);
    const withdrawn = await service.withdraw(input);
    assert.ok((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='historical-link'")).rows[0].revoked_at);
    assert.equal(withdrawn.action,"WITHDRAWN");
    await db.query("UPDATE scoped_share_links SET revoked_at=NULL WHERE share_link_id='historical-link'");
    await service.withdraw(input);
    assert.ok((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='historical-link'")).rows[0].revoked_at);
    assert.equal((await service.listWorkerHistory(worker)).filter(row => row.consentId === granted.consentId).length,2);
  } finally { await db.close(); }
});
