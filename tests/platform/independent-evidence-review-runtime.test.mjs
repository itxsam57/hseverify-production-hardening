import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { authorizeReviewFixture } from "../helpers/evidence-review-calibration-fixture.mjs";

const runtime = process.env.HSE_EVIDENCE_REVIEW_RUNTIME_DIST ?? ".evidence-review-runtime-test-dist";
if (!existsSync(runtime)) {
  const prepared = spawnSync(process.execPath, ["scripts/run-evidence-review-runtime-tests.mjs"], {
    env: { ...process.env, HSE_EVIDENCE_REVIEW_PREPARE_ONLY: "1" },
    stdio: "inherit"
  });
  assert.equal(prepared.status, 0, "Independent evidence runtime preparation failed");
}

const serviceModule = await import(
  pathToFileURL(join(runtime, "review", "evidence-review-service.js")).href
);
const { EvidenceReviewService } = serviceModule;

const NOW = "2026-09-23T04:30:00.000Z";
const NOW_DATE = new Date(NOW);
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "independent-evidence-review-runtime-test",
  sessionSecret: "independent-evidence-review-session-secret-2026-000000",
  authPepper: "independent-evidence-review-auth-pepper-2026-00000000",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, char) => `${prefix}_${char.repeat(24)}`;

async function database(through = "0107_review_calibration_audit") {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, through);
  return db;
}
async function authorizeAndClaim(db,service,verifier,taskId,at=NOW_DATE) {
  await authorizeReviewFixture(db,{taskId,verifiers:[verifier],at});
  return service.claim(verifier,taskId,at);
}

async function seedAccount(db, { accountId, email, role, sessionId }) {
  await db.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, `Independent ${role}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await db.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)`,
    [accountId, role, NOW]
  );
  await db.query(
    `INSERT INTO auth_sessions(
       session_id,account_id,active_role,token_hash,csrf_token_hash,
       created_at,last_seen_at,expires_at
     ) VALUES($1,$2,$3,$4,$5,$6,$6,$7)`,
    [sessionId, accountId, role, `token-${role}`, `csrf-${role}`, NOW, FUTURE]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: role,
    accountStatus: "active",
    email,
    displayName: `Independent ${role}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null
  });
}

async function seedEvidence(db, workerAccountId, kind, char) {
  const recordId = oid("evidence_record", char);
  const versionId = oid("evidence_version", char);
  await db.query(
    `INSERT INTO worker_evidence_records(
       record_id,worker_account_id,record_kind,lifecycle_status,
       current_version_id,created_at,updated_at
     ) VALUES($1,$2,$3,'active',NULL,$4,$4)`,
    [recordId, workerAccountId, kind, NOW]
  );
  await db.query(
    `INSERT INTO worker_evidence_versions(
       version_id,record_id,version_number,revision,version_status,
       supersedes_version_id,created_at,updated_at,submitted_at
     ) VALUES($1,$2,1,1,'submitted',NULL,$3,$3,$3)`,
    [versionId, recordId, NOW]
  );
  await db.query(
    `UPDATE worker_evidence_records
        SET current_version_id=$2,updated_at=$3
      WHERE record_id=$1`,
    [recordId, versionId, NOW]
  );
  return { recordId, versionId };
}

async function seedManualReviewIdentity(db, workerAccountId) {
  const identityId = oid("worker_identity", "I");
  const versionId = oid("identity_version", "V");
  const account = await db.query(
    `SELECT email_normalized FROM auth_accounts WHERE account_id=$1`,
    [workerAccountId]
  );
  const email = account.rows[0].email_normalized;
  const phone = "+923000000002";

  await db.query(
    `UPDATE auth_accounts
        SET phone_e164=$2,phone_verified_at=$3,updated_at=$3
      WHERE account_id=$1`,
    [workerAccountId, phone, NOW]
  );
  await db.query(
    `INSERT INTO worker_identities(
       identity_id,worker_account_id,lifecycle_status,current_version_number,
       lock_version,created_at,updated_at
     ) VALUES($1,$2,'draft',1,1,$3,$3)`,
    [identityId, workerAccountId, NOW]
  );
  await db.query(
    `INSERT INTO worker_identity_versions(
       identity_version_id,identity_id,version_number,parent_version_id,
       version_kind,version_status,created_by_account_id,created_at,submitted_at
     ) VALUES($1,$2,1,NULL,'initial','draft',$3,$4,NULL)`,
    [versionId, identityId, workerAccountId, NOW]
  );
  await db.query(
    `INSERT INTO worker_identity_version_drafts(
       identity_version_id,draft_revision,
       legal_first_name,legal_last_name,previous_legal_name,date_of_birth,
       nationality,country_of_residence,
       verified_email_normalized,email_verified_at,
       verified_phone_e164,phone_verified_at,
       contact_snapshot_at,created_at,updated_at
     ) VALUES(
       $1,1,'Independent','Worker',NULL,'1990-01-01',
       'Pakistani','Pakistan',$2,$3,$4,$3,$3,$3,$3
     )`,
    [versionId, email, NOW, phone]
  );

  const fixtures = [
    {
      purpose: "identity_document",
      fileId: oid("secure_file", "D"),
      bindingId: oid("identity_evidence", "D"),
      jobId: "job_independent_identity_document",
      reservation: "1".repeat(64),
      objectHash: "4".repeat(64),
      contentHash: "7".repeat(64),
      mime: "application/pdf",
      extension: "pdf",
      documentType: "passport",
      documentNumber: "INDEPENDENT-ID-001",
      issueDate: "2025-01-01",
      expiryDate: "2035-01-01"
    },
    {
      purpose: "profile_photo",
      fileId: oid("secure_file", "P"),
      bindingId: oid("identity_evidence", "P"),
      jobId: "job_independent_profile_photo",
      reservation: "2".repeat(64),
      objectHash: "5".repeat(64),
      contentHash: "8".repeat(64),
      mime: "image/png",
      extension: "png",
      documentType: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null
    },
    {
      purpose: "selfie",
      fileId: oid("secure_file", "S"),
      bindingId: oid("identity_evidence", "S"),
      jobId: "job_independent_selfie",
      reservation: "3".repeat(64),
      objectHash: "6".repeat(64),
      contentHash: "9".repeat(64),
      mime: "image/jpeg",
      extension: "jpg",
      documentType: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null
    }
  ];

  for (const fixture of fixtures) {
    await db.query(
      `INSERT INTO platform_outbox_jobs(
         job_id,job_type,schema_version,idempotency_key,payload,
         enqueued_by_account_id,enqueued_by_role,status,attempt_count,max_attempts,
         next_attempt_at,succeeded_at,created_at,updated_at
       ) VALUES(
         $1,'secure_file.scan',1,$2,$3::jsonb,$4,'worker',
         'succeeded',1,5,$5,$5,$5,$5
       )`,
      [
        fixture.jobId,
        fixture.contentHash,
        JSON.stringify({ fileRef: fixture.fileId, generation: 1 }),
        workerAccountId,
        NOW
      ]
    );
    await db.query(
      `INSERT INTO platform_secure_files(
         file_id,schema_version,reservation_key,owner_account_id,owner_role,
         tenant_id,membership_id,storage_adapter_key,object_key,display_filename,
         lifecycle_status,file_extension,declared_mime,detected_mime,byte_size,
         content_sha256,quarantined_at,available_at,created_at,updated_at,
         scan_generation,scan_job_id,scan_result_code,scan_completed_at
       ) VALUES(
         $1,1,$2,$3,'worker',NULL,NULL,'local_test',$4,$5,
         'available',$6,$7,$7,128,$8,$9,$9,$9,$9,
         1,$10,'clean',$9
       )`,
      [
        fixture.fileId,
        fixture.reservation,
        workerAccountId,
        `secure-files/${fixture.objectHash}`,
        `identity-${fixture.purpose}.${fixture.extension}`,
        fixture.extension,
        fixture.mime,
        fixture.contentHash,
        NOW,
        fixture.jobId
      ]
    );
    await db.query(
      `INSERT INTO worker_identity_evidence_bindings(
         binding_id,identity_version_id,worker_account_id,purpose,secure_file_id,
         document_type,document_number,issue_date,expiry_date,binding_status,
         supersedes_binding_id,created_by_account_id,created_at
       ) VALUES(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,'active',NULL,$3,$10
       )`,
      [
        fixture.bindingId,
        versionId,
        workerAccountId,
        fixture.purpose,
        fixture.fileId,
        fixture.documentType,
        fixture.documentNumber,
        fixture.issueDate,
        fixture.expiryDate,
        NOW
      ]
    );
  }

  await db.query(
    `UPDATE worker_identity_versions
        SET version_status='submitted',submitted_at=$2
      WHERE identity_version_id=$1`,
    [versionId, NOW]
  );
  for (const [status, lockVersion] of [
    ["submitted", 2],
    ["automated_checks", 3],
    ["manual_review", 4]
  ]) {
    await db.query(
      `UPDATE worker_identities
          SET lifecycle_status=$2,lock_version=$3,updated_at=$4
        WHERE identity_id=$1`,
      [identityId, status, lockVersion, NOW]
    );
  }
  return { identityId, versionId };
}

test("independent Worker submissions reach Verifier and approve/reject outcomes persist", async () => {
  const db = await database();
  try {
    const worker = await seedAccount(db, {
      accountId: "account_independent_worker_01",
      email: "worker-independent@example.test",
      role: "worker",
      sessionId: "session_independent_worker_01"
    });
    const verifier = await seedAccount(db, {
      accountId: "account_independent_verifier_01",
      email: "verifier-independent@example.test",
      role: "verifier",
      sessionId: "session_independent_verifier_01"
    });

    const qualification = await seedEvidence(db, worker.accountId, "qualification", "Q");
    const experience = await seedEvidence(db, worker.accountId, "experience", "E");

    const service = new EvidenceReviewService(db);
    const qualificationTask = await service.queueIndependentWorkerEvidence(
      worker,
      qualification.recordId,
      NOW_DATE
    );
    const experienceTask = await service.queueIndependentWorkerEvidence(
      worker,
      experience.recordId,
      NOW_DATE
    );

    const queue = await service.listQueue(verifier);
    assert.equal(queue.length, 2);
    assert.deepEqual(
      new Set(queue.map((item) => item.evidenceKind)),
      new Set(["qualification", "experience"])
    );
    assert(queue.every((item) => item.tenantId === null && item.caseId === null));

    await authorizeAndClaim(db,service,verifier,qualificationTask.taskId,NOW_DATE);
    await service.decide(
      verifier,
      qualificationTask.taskId,
      "APPROVED",
      "Qualification source and submitted certificate details were verified.",
      NOW_DATE
    );

    await authorizeAndClaim(db,service,verifier,experienceTask.taskId,NOW_DATE);
    await service.decide(
      verifier,
      experienceTask.taskId,
      "REJECTED",
      "Experience evidence does not establish the claimed period.",
      NOW_DATE
    );

    const stored = await db.query(
      `SELECT evidence_kind,task_status
         FROM evidence_review_tasks
        WHERE worker_account_id=$1
        ORDER BY evidence_kind`,
      [worker.accountId]
    );
    assert.deepEqual(
      stored.rows.map((row) => [row.evidence_kind, row.task_status]),
      [["experience", "REJECTED"], ["qualification", "APPROVED"]]
    );

    const decisions = await db.query(
      `SELECT tasks.evidence_kind,decisions.outcome,decisions.reason
         FROM evidence_review_decisions AS decisions
         JOIN evidence_review_tasks AS tasks ON tasks.task_id=decisions.task_id
        WHERE tasks.worker_account_id=$1
        ORDER BY tasks.evidence_kind`,
      [worker.accountId]
    );
    assert.deepEqual(
      decisions.rows.map((row) => row.outcome),
      ["REJECTED", "APPROVED"]
    );
  } finally {
    await db.close();
  }
});

// Reuse the same existing M1.07.05 native case against isolated actual PG16
// when requested. Each invocation owns and drops only its fresh synthetic
// database, never the long-running PostgreSQL service or another test's DB.
async function m10705CorrectionDatabase() {
  const connection=process.env.HSE_M10705_POSTGRES_TEST_DATABASE_URL;
  if(!connection){
    const db=await database("0130_verified_identity_correction_notices");
    return {db,dispose:async()=>db.close()};
  }
  const admin=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:connection});
  const databaseName="m10705_"+Date.now()+"_"+process.pid;
  let db;
  let created=false;
  try{
    await admin.execute('CREATE DATABASE "'+databaseName+'"');
    created=true;
    const isolated=new URL(connection);
    isolated.pathname="/"+databaseName;
    db=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:isolated.href});
    await applyMigrationsThrough(db,"m10705-actual-postgres-isolated","0130_verified_identity_correction_notices");
    return {db,dispose:async()=>{
      try {await db.close();}
      finally{
        try{await admin.execute('DROP DATABASE "'+databaseName+'"');}
        finally{await admin.close();}
      }
    }};
  }catch(error){
    if(db)await db.close();
    try{if(created)await admin.execute('DROP DATABASE "'+databaseName+'"');}
    finally{await admin.close();}
    throw error;
  }
}

test("independent identity manual review reaches Verifier and approved outcome verifies Worker identity", {timeout:120000}, async () => {
  const {db,dispose} = await m10705CorrectionDatabase();
  try {
    const worker = await seedAccount(db, {
      accountId: "account_independent_worker_02",
      email: "worker-identity-independent@example.test",
      role: "worker",
      sessionId: "session_independent_worker_02"
    });
    const verifier = await seedAccount(db, {
      accountId: "account_independent_verifier_02",
      email: "verifier-identity-independent@example.test",
      role: "verifier",
      sessionId: "session_independent_verifier_02"
    });
    await seedManualReviewIdentity(db, worker.accountId);

    const service = new EvidenceReviewService(db);
    const task = await service.queueIndependentIdentity(worker, NOW_DATE);
    assert.equal(task.evidenceKind, "identity");
    assert.equal(task.tenantId, null);
    assert.equal(task.caseId, null);

    await authorizeAndClaim(db,service,verifier,task.taskId,NOW_DATE);
    await service.decide(
      verifier,
      task.taskId,
      "APPROVED",
      "Identity evidence and automated review signals support verification.",
      NOW_DATE
    );

    const identity = await db.query(
      `SELECT lifecycle_status FROM worker_identities WHERE worker_account_id=$1`,
      [worker.accountId]
    );
    assert.equal(identity.rows[0].lifecycle_status, "verified");

    const permanentId = await db.query(
      `SELECT permanent_worker_id
         FROM worker_identity_worker_ids
        WHERE worker_account_id=$1`,
      [worker.accountId]
    );
    assert.equal(permanentId.rows.length, 1);
    assert.match(
      permanentId.rows[0].permanent_worker_id,
      /^worker_id_[A-Za-z0-9_-]{24}$/
    );

    const review = await db.query(
      `SELECT task_status FROM evidence_review_tasks WHERE task_id=$1`,
      [task.taskId]
    );
    assert.equal(review.rows[0].task_status, "APPROVED");
    const { DatabaseWorkerIdentityCorrectionRepository } = await import(pathToFileURL(join(runtime, "identity", "worker-identity-correction-repository.js")).href);
    const corrections = new DatabaseWorkerIdentityCorrectionRepository(Promise.resolve(db));
    const originalId = permanentId.rows[0].permanent_worker_id;
    // Original M1.07.06 retention: preserve exact verified v1 and its real
    // bound secure-file metadata before changing the active verified version.
    const immutableWorkerId=(await db.query(
      "SELECT * FROM worker_identity_worker_ids WHERE worker_account_id=$1",
      [worker.accountId]
    )).rows;
    assert.equal(immutableWorkerId.length,1);
    const identityId=immutableWorkerId[0].identity_id;
    const originalVersion=(await db.query(
      "SELECT * FROM worker_identity_versions WHERE identity_id=$1 AND version_number=1",
      [identityId]
    )).rows[0];
    assert.equal(originalVersion.version_kind,"initial");
    assert.equal(originalVersion.version_status,"submitted");
    const originalDetails=(await db.query(
      "SELECT * FROM worker_identity_version_drafts WHERE identity_version_id=$1",
      [originalVersion.identity_version_id]
    )).rows[0];
    const originalBindings=(await db.query(
      "SELECT * FROM worker_identity_evidence_bindings WHERE identity_version_id=$1 ORDER BY purpose,binding_id",
      [originalVersion.identity_version_id]
    )).rows;
    assert.deepEqual(originalBindings.map(x=>x.purpose).sort(),
      ["identity_document","profile_photo","selfie"]);
    const boundOriginalFiles=(await db.query(
      "SELECT file_id,owner_account_id,lifecycle_status,content_sha256,object_key "+
      "FROM platform_secure_files WHERE file_id=ANY($1::text[]) ORDER BY file_id",
      [originalBindings.map(x=>x.secure_file_id)]
    )).rows;
    assert.equal(boundOriginalFiles.length,3);
    assert.ok(boundOriginalFiles.every(x=>x.owner_account_id===worker.accountId&&x.lifecycle_status==="available"));

    // M1.07.05 adds only missing receiving-side evidence. The original
    // historically green case already covers all three outcomes, denial of
    // duplicate finalization, and preservation of verified parent/Worker ID.
    const decisionNoticeIds=[];
    const decisionRefsByOutcome=new Map();
    const assertWorkerCorrectionNotice=async (taskId,outcome)=>{
      const decision=(await db.query(
        "SELECT decision_id,outcome,source_version_id,verifier_account_id "+
        "FROM evidence_review_decisions WHERE task_id=$1",
        [taskId]
      )).rows;
      assert.equal(decision.length,1);
      assert.equal(decision[0].outcome,outcome);
      assert.equal(decision[0].verifier_account_id,verifier.accountId);
      const eventType=outcome==="CHANGES_REQUESTED"?"evidence.additional.requested":"evidence.reviewed";
      const eventRef="review:"+decision[0].decision_id;
      const jobs=(await db.query(
        "SELECT job_id,job_type FROM platform_outbox_jobs "+
        "WHERE job_type IN ('notification.assurance.event','email.assurance.event') "+
        "AND payload->>'eventType'=$1 AND payload->>'eventRef'=$2",
        [eventType,eventRef]
      )).rows;
      const inApp=jobs.filter(j=>j.job_type==="notification.assurance.event");
      assert.equal(inApp.length,1,"Exactly one original in-app review event intent.");
      assert.ok(jobs.some(j=>j.job_type==="email.assurance.event"),
        "Correction result must retain intended email delivery, not a provider send claim.");
      const projected=(await db.query(
        "SELECT created,suppressed FROM platform_project_assurance_event_notification($1)",
        [inApp[0].job_id]
      )).rows[0];
      assert.deepEqual(projected,{created:1,suppressed:false},
        "Worker must receive each verified correction decision including rejected and changes requested.");
      const notices=(await db.query(
        "SELECT recipient_account_id,recipient_role,tenant_id,membership_id,notification_type,"+
        "target_key,target_reference,metadata FROM platform_notifications WHERE source_job_id=$1",
        [inApp[0].job_id]
      )).rows;
      assert.equal(notices.length,1,"Only the Worker can receive an original identity correction result.");
      assert.equal(notices[0].recipient_account_id,worker.accountId);
      assert.equal(notices[0].recipient_role,"worker");
      assert.equal(notices[0].tenant_id,null);
      assert.equal(notices[0].membership_id,null);
      assert.equal(notices[0].notification_type,eventType);
      assert.equal(notices[0].target_key,"worker.identity.record");
      assert.equal(notices[0].target_reference,(await db.query(
        "SELECT identity_id FROM worker_identities WHERE worker_account_id=$1",
        [worker.accountId]
      )).rows[0].identity_id);
      assert.equal(notices[0].metadata.eventRef,eventRef);
      assert.deepEqual((await db.query(
        "SELECT created,suppressed FROM platform_project_assurance_event_notification($1)",
        [inApp[0].job_id]
      )).rows[0],{created:0,suppressed:false},
      "Exact original event replay cannot create a second notification.");
      decisionNoticeIds.push(inApp[0].job_id);
      decisionRefsByOutcome.set(outcome,{eventType,eventRef});
      console.log("M10705_CORRECTION_OUTCOME_NOTICE",
        outcome,"one Worker-only private identity notice and intended email; replay0");
    };
    for (const outcome of ["APPROVED", "REJECTED", "CHANGES_REQUESTED"]) {
      const before = (await db.query("SELECT lock_version,current_version_number FROM worker_identities WHERE worker_account_id=$1", [worker.accountId])).rows[0];
      await corrections.requestOwn(worker, { reason: "Correct the legal spelling against preserved signed identity evidence.", expectedLockVersion: Number(before.lock_version) });
      const pending = (await db.query("SELECT lock_version FROM worker_identities WHERE worker_account_id=$1", [worker.accountId])).rows[0];
      await corrections.submitOwn(worker, Number(pending.lock_version));
      const correctionTask = await service.queueIndependentIdentity(worker, NOW_DATE);
      await authorizeAndClaim(db,service,verifier,correctionTask.taskId,NOW_DATE);
      await service.decide(verifier, correctionTask.taskId, outcome, "Independent correction decision with preserved prior verified identity.", NOW_DATE);
      await assertWorkerCorrectionNotice(correctionTask.taskId,outcome);
      const after = (await db.query("SELECT lifecycle_status,current_version_number FROM worker_identities WHERE worker_account_id=$1", [worker.accountId])).rows[0];
      assert.equal(after.lifecycle_status, "verified");
      if (outcome !== "APPROVED") assert.equal(after.current_version_number, before.current_version_number);
      const history = await corrections.loadOwn(worker);
      assert.equal(history.decision, outcome === "APPROVED" ? "accepted" : "rejected");
      assert.equal((await db.query("SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1", [worker.accountId])).rows[0].permanent_worker_id, originalId);
      await assert.rejects(service.decide(verifier, correctionTask.taskId, outcome, "Repeated finalized decision must be rejected.", NOW_DATE));
    }
    assert.equal(decisionNoticeIds.length,3);
    assert.equal(new Set(decisionNoticeIds).size,3);
    console.log("M10705_ALL_THREE_VERIFIED_CORRECTION_WORKER_NOTICES",
      "APPROVED, REJECTED, CHANGES_REQUESTED each one correctly scoped Worker original event/identity link; all three replays0 and permanent Worker ID retained");
    // Migration rollback must restore the old exact recipient function
    // (including its documented legacy suppression), then a reapply must
    // recover current behavior without rewriting any existing notice.
    const currentDefinition=(await db.query(
      "SELECT pg_get_functiondef('platform_assurance_event_recipients(text,text)'::regprocedure) AS definition"
    )).rows[0].definition;
    await db.execute(readFileSync("database/migrations/0130_verified_identity_correction_notices.down.sql","utf8"));
    for(const outcome of ["REJECTED","CHANGES_REQUESTED"]){
      const {eventType,eventRef}=decisionRefsByOutcome.get(outcome);
      const reverted=(await db.query(
        "SELECT account_id,role FROM platform_assurance_event_recipients($1,$2)",
        [eventType,eventRef]
      )).rows;
      assert.equal(reverted.length,0,
        "Down migration must restore original current-version-only rule without leaking to other roles.");
    }
    await db.execute(readFileSync("database/migrations/0130_verified_identity_correction_notices.up.sql","utf8"));
    const restoredDefinition=(await db.query(
      "SELECT pg_get_functiondef('platform_assurance_event_recipients(text,text)'::regprocedure) AS definition"
    )).rows[0].definition;
    assert.equal(restoredDefinition,currentDefinition,"0130 rollback/reapply must preserve installed function contract exactly.");
    for(const outcome of ["REJECTED","CHANGES_REQUESTED"]){
      const {eventType,eventRef}=decisionRefsByOutcome.get(outcome);
      const restored=(await db.query(
        "SELECT account_id,role,target_key FROM platform_assurance_event_recipients($1,$2)",
        [eventType,eventRef]
      )).rows;
      assert.deepEqual(restored,[{account_id:worker.accountId,role:"worker",target_key:"worker.identity.record"}]);
    }
    const storedNotices=(await db.query(
      "SELECT source_job_id FROM platform_notifications WHERE source_job_id=ANY($1::text[])",
      [decisionNoticeIds]
    )).rows;
    assert.equal(storedNotices.length,3,"Rollback/reapply cannot delete accepted immutable Worker notification history.");
    console.log("M10705_0130_ROLLBACK_REAPPLY_DB",
      "real original recipients restored on down, exact new definition/Worker corrections restored on up, all 3 immutable delivered notices preserved");
    // Native negative abuse probes: a caller cannot turn one outcome into
    // another, fabricate a review event or receive another Worker's result.
    const unrelated={accountId:"account_independent_unrelated_worker_02"};
    // This foreign Worker needs a real active account/role to be a
    // potential notification recipient, not a duplicate auth session.
    // The old seed helper's token_hash is intentionally unique per role.
    await db.query(
      "INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,"+
      "email_verified_at,password_set_at,created_at,updated_at) "+
      "SELECT $1,'unrelated-correction-worker@example.test','Unrelated Worker','active',password_hash,"+
      "email_verified_at,password_set_at,created_at,updated_at FROM auth_accounts WHERE account_id=$2",
      [unrelated.accountId,worker.accountId]
    );
    await db.query(
      "INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",
      [unrelated.accountId,NOW]
    );
    for(const [outcome,{eventType,eventRef}] of decisionRefsByOutcome){
      const incorrectType=eventType==="evidence.additional.requested"
        ?"evidence.reviewed":"evidence.additional.requested";
      assert.deepEqual((await db.query(
        "SELECT account_id FROM platform_assurance_event_recipients($1,$2)",
        [incorrectType,eventRef]
      )).rows,[],"Changing the event type of a genuine decision cannot create a recipient.");
      const legitimate=(await db.query(
        "SELECT account_id,role,tenant_id,membership_id FROM platform_assurance_event_recipients($1,$2)",
        [eventType,eventRef]
      )).rows;
      assert.deepEqual(legitimate,[{
        account_id:worker.accountId,role:"worker",tenant_id:null,membership_id:null
      }],"Even replaying an exact decision has only one Worker owner and no tenant scope.");
    }
    assert.deepEqual((await db.query(
      "SELECT account_id FROM platform_assurance_event_recipients($1,$2)",
      ["evidence.reviewed","review:missing_verifier_decision"]
    )).rows,[],"Fabricated decision reference cannot create a recipient.");
    assert.equal((await db.query(
      "SELECT count(*)::int n FROM platform_notifications WHERE recipient_account_id=$1",
      [unrelated.accountId]
    )).rows[0].n,0,"Another Worker must never receive the authenticated subject's correction notices.");
    assert.equal((await db.query(
      "SELECT count(*)::int n FROM platform_notifications WHERE source_job_id=ANY($1::text[])",
      [decisionNoticeIds]
    )).rows[0].n,3);
    console.log("M10705_0130_TAMPERED_EVENT_WRONG_WORKER_DENIAL_DB",
      "all three forged outcome types, missing decision and foreign Worker delivery denied; genuine Worker-only same original 3 notices");
    // M1.07.06 source-data tampering after three completed corrections:
    // verify the exact submitted initial record and all three original secure
    // document/photo/selfie bindings remain intact, not just an ID count.
    const afterId=(await db.query(
      "SELECT * FROM worker_identity_worker_ids WHERE worker_account_id=$1",
      [worker.accountId]
    )).rows;
    assert.deepEqual(afterId,immutableWorkerId);
    assert.equal((await db.query(
      "SELECT lifecycle_status,current_version_number FROM worker_identities WHERE identity_id=$1",
      [identityId]
    )).rows[0].current_version_number,2,
    "Only accepted correction v2 is current after rejected and changes requested.");
    assert.deepEqual((await db.query(
      "SELECT * FROM worker_identity_versions WHERE identity_version_id=$1",
      [originalVersion.identity_version_id]
    )).rows[0],originalVersion);
    assert.deepEqual((await db.query(
      "SELECT * FROM worker_identity_version_drafts WHERE identity_version_id=$1",
      [originalVersion.identity_version_id]
    )).rows[0],originalDetails);
    assert.deepEqual((await db.query(
      "SELECT * FROM worker_identity_evidence_bindings WHERE identity_version_id=$1 ORDER BY purpose,binding_id",
      [originalVersion.identity_version_id]
    )).rows,originalBindings);
    assert.deepEqual((await db.query(
      "SELECT file_id,owner_account_id,lifecycle_status,content_sha256,object_key FROM platform_secure_files "+
      "WHERE file_id=ANY($1::text[]) ORDER BY file_id",
      [originalBindings.map(x=>x.secure_file_id)]
    )).rows,boundOriginalFiles);
    const accepted=(await db.query(
      "SELECT identity_version_id FROM worker_identity_versions WHERE identity_id=$1 AND version_number=2",
      [identityId]
    )).rows[0];
    const acceptedBindings=(await db.query(
      "SELECT purpose,secure_file_id,identity_version_id FROM worker_identity_evidence_bindings "+
      "WHERE identity_version_id=$1",
      [accepted.identity_version_id]
    )).rows;
    assert.equal(acceptedBindings.length,3);
    assert.ok(acceptedBindings.every(x=>
      originalBindings.some(original=>original.purpose===x.purpose&&original.secure_file_id===x.secure_file_id)));
    // Mutations use genuine original object IDs and even valid no-op values:
    // validation must fail due immutable history, not because inputs are malformed.
    await assert.rejects(()=>db.query(
      "UPDATE worker_identity_worker_ids SET permanent_worker_id=permanent_worker_id WHERE worker_account_id=$1",
      [worker.accountId]));
    await assert.rejects(()=>db.query(
      "DELETE FROM worker_identity_worker_ids WHERE worker_account_id=$1",
      [worker.accountId]));
    await assert.rejects(()=>db.query(
      "UPDATE worker_identity_evidence_bindings SET secure_file_id=secure_file_id WHERE binding_id=$1",
      [originalBindings[0].binding_id]));
    await assert.rejects(()=>db.query(
      "DELETE FROM worker_identity_evidence_bindings WHERE binding_id=$1",
      [originalBindings[0].binding_id]));
    await assert.rejects(()=>db.query(
      "UPDATE worker_identity_version_drafts SET legal_first_name='FORGED' WHERE identity_version_id=$1",
      [originalVersion.identity_version_id]));
    assert.deepEqual((await db.query(
      "SELECT * FROM worker_identity_worker_ids WHERE worker_account_id=$1",
      [worker.accountId]
    )).rows,immutableWorkerId);
    assert.deepEqual((await db.query(
      "SELECT * FROM worker_identity_evidence_bindings WHERE identity_version_id=$1 ORDER BY purpose,binding_id",
      [originalVersion.identity_version_id]
    )).rows,originalBindings);
    console.log("M10706_ORIGINAL_EVIDENCE_ID_TAMPER_DENIED_DB",
      "original Worker ID, version1 original details and all 3 stored original file ownership/hashes retained after accepted, rejected and changes-requested corrections; direct ID/evidence/update/delete/forged-name denied");
    console.log("M10706_VERIFIED_PARENT_CORRECTION_RETENTION_DB",
      "only accepted version2 active, all 3 exact original file bindings carried forward and original version1 immutable, Worker ID one");


  } finally {
    await dispose();
  }
});


test("approved case review automatically creates and assigns a required interview to an active assessor", async () => {
  const db = await database("0107_review_calibration_audit");
  try {
    const worker = await seedAccount(db, {
      accountId: "account_interview_worker_01",
      email: "worker-interview@example.test",
      role: "worker",
      sessionId: "session_interview_worker_01"
    });
    const verifier = await seedAccount(db, {
      accountId: "account_interview_verifier_01",
      email: "verifier-interview@example.test",
      role: "verifier",
      sessionId: "session_interview_verifier_01"
    });
    const assessor = await seedAccount(db, {
      accountId: "account_interview_assessor_01",
      email: "assessor-interview@example.test",
      role: "assessor",
      sessionId: "session_interview_assessor_01"
    });

    const tenantId = oid("tenant", "T");
    const orderId = oid("assurance_order", "O");
    const targetId = oid("assurance_target", "G");
    const caseId = oid("assurance_case", "C");
    const taskId = oid("evidence_review", "R");

    await db.query(
      `INSERT INTO platform_tenants(
         tenant_id,tenant_type,display_name,tenant_status,created_at,updated_at,activated_at
       ) VALUES($1,'company','Interview Integration Company','active',$2,$2,$2)`,
      [tenantId, NOW]
    );
    await db.query(
      `INSERT INTO assurance_orders(
         order_id,tenant_id,created_by_membership_id,order_name,order_reference,
         requested_identity_checks,requested_evidence_checks,assessment_framework_references,
         interview_required,order_status,submitted_at,created_at,updated_at
       ) VALUES($1,$2,$3,'Interview-required order','INTERVIEW-REQ-001',
                '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,TRUE,'SUBMITTED',$4,$4,$4)`,
      [orderId, tenantId, oid("membership", "M"), NOW]
    );
    await db.query(
      `INSERT INTO assurance_order_workers(
         target_id,order_id,tenant_id,worker_link_id,worker_account_id,
         funding_method,target_status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)`,
      [targetId, orderId, tenantId, oid("company_worker_link", "L"), worker.accountId, NOW]
    );
    await db.query(
      `INSERT INTO assurance_cases(
         case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
         case_status,owner_kind,next_action,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,'Review pending','reviewer','Review assigned evidence.',$7,$7)`,
      [caseId, orderId, targetId, tenantId, oid("company_worker_link", "L"), worker.accountId, NOW]
    );
    const source=await seedEvidence(db,worker.accountId,"qualification","S");
    await db.query(
      `INSERT INTO evidence_review_tasks(task_id,tenant_id,case_id,worker_account_id,evidence_kind,source_record_id,source_version_id,evidence_label,task_status,created_at,updated_at)
       VALUES($1,$2,$3,$4,'qualification',$5,$6,'Interview integration qualification','QUEUED',$7,$7)`,
      [taskId,tenantId,caseId,worker.accountId,source.recordId,source.versionId,NOW]
    );

    const service = new EvidenceReviewService(db);
    await authorizeAndClaim(db,service,verifier,taskId,NOW_DATE);
    await service.decide(
      verifier,
      taskId,
      "APPROVED",
      "Observation is attributable, current and sufficient for this case.",
      NOW_DATE
    );

    const caseState = await db.query(
      `SELECT case_status,owner_kind,next_action,interview_reference
         FROM assurance_cases WHERE case_id=$1`,
      [caseId]
    );
    assert.equal(caseState.rows[0].case_status, "Interview pending");
    assert.equal(caseState.rows[0].owner_kind, "assessor");
    assert.match(caseState.rows[0].next_action, /schedule/i);
    assert.match(caseState.rows[0].interview_reference ?? "", /^interview_request_[A-Za-z0-9_-]{24}$/);

    const interview = await db.query(
      `SELECT interview_request_id,case_id,worker_account_id,status,assessor_account_id
         FROM interview_requests WHERE case_id=$1`,
      [caseId]
    );
    assert.equal(interview.rows.length, 1);
    assert.equal(interview.rows[0].interview_request_id, caseState.rows[0].interview_reference);
    assert.equal(interview.rows[0].worker_account_id, worker.accountId);
    assert.equal(interview.rows[0].status, "ASSIGNED");
    assert.equal(interview.rows[0].assessor_account_id, assessor.accountId);
  } finally {
    await db.close();
  }
});

test("returned initial identity creates a locked lineage revision; invalid authority, stale writes and history rollback are denied", async () => {
  const db=await database();
  try {
    const up=readFileSync("database/migrations/0077_worker_identity_more_info_revision.up.sql","utf8");
    const down=readFileSync("database/migrations/0077_worker_identity_more_info_revision.down.sql","utf8");
    await db.execute(up);await db.execute(down);await db.execute(up);
    const worker=await seedAccount(db,{accountId:"account_more_info_worker_01",email:"more-info-worker@example.test",role:"worker",sessionId:"session_more_info_worker_01"});
    const verifier=await seedAccount(db,{accountId:"account_more_info_verifier_01",email:"more-info-verifier@example.test",role:"verifier",sessionId:"session_more_info_verifier_01"});
    await seedManualReviewIdentity(db,worker.accountId);
    const service=new EvidenceReviewService(db);
    // Frozen M1.07.04: the original case already proved correct revision
    // lineage, stale-write denial and final approval. Add only its missing
    // real event-driven receiving-side notification contract for each version.
    const decisionNotices=[];
    const assertWorkerDecisionNotice=async (taskId,eventType,versionId)=>{
      const decisions=(await db.query(
        "SELECT decision_id,outcome,source_version_id,verifier_account_id FROM evidence_review_decisions WHERE task_id=$1",
        [taskId]
      )).rows;
      assert.equal(decisions.length,1,"Each finalized task must have one immutable human decision.");
      assert.equal(decisions[0].source_version_id,versionId);
      assert.equal(decisions[0].verifier_account_id,verifier.accountId);
      const eventRef="review:"+decisions[0].decision_id;
      const jobs=(await db.query(
        "SELECT job_id,job_type FROM platform_outbox_jobs "+
        "WHERE job_type IN ('notification.assurance.event','email.assurance.event') "+
        "AND payload->>'eventType'=$1 AND payload->>'eventRef'=$2",
        [eventType,eventRef]
      )).rows;
      const inApp=jobs.filter(j=>j.job_type==="notification.assurance.event");
      assert.equal(inApp.length,1,"One original in-app delivery intent per actual decision.");
      assert.ok(jobs.some(j=>j.job_type==="email.assurance.event"),
        "Review decision must preserve intended email delivery (NOT provider send).");
      const projected=(await db.query(
        "SELECT created,suppressed FROM platform_project_assurance_event_notification($1)",
        [inApp[0].job_id]
      )).rows[0];
      assert.deepEqual(projected,{created:1,suppressed:false});
      const notifications=(await db.query(
        "SELECT notification_type,recipient_account_id,recipient_role,tenant_id,membership_id,"+
        "target_key,target_reference,title,metadata FROM platform_notifications WHERE source_job_id=$1",
        [inApp[0].job_id]
      )).rows;
      assert.equal(notifications.length,1,"Decision must notify exactly the Worker, not Verifier/Admin.");
      const message=notifications[0];
      assert.equal(message.notification_type,eventType);
      assert.equal(message.recipient_account_id,worker.accountId);
      assert.equal(message.recipient_role,"worker");
      assert.equal(message.tenant_id,null);
      assert.equal(message.membership_id,null);
      assert.equal(message.target_key,"worker.identity.record");
      assert.equal(message.target_reference,(await db.query(
        "SELECT identity_id FROM worker_identities WHERE worker_account_id=$1",
        [worker.accountId]
      )).rows[0].identity_id);
      assert.equal(message.metadata.eventRef,eventRef);
      assert.deepEqual((await db.query(
        "SELECT created,suppressed FROM platform_project_assurance_event_notification($1)",
        [inApp[0].job_id]
      )).rows[0],{created:0,suppressed:false},
      "Replay must not duplicate an existing authorized notice.");
      decisionNotices.push({eventType,eventRef,jobId:inApp[0].job_id});
    };
    const task=await service.queueIndependentIdentity(worker,NOW_DATE);
    await authorizeAndClaim(db,service,verifier,task.taskId,NOW_DATE);
    await service.decide(verifier,task.taskId,"CHANGES_REQUESTED","The document photograph must be corrected before initial identity verification.",NOW_DATE);
    const firstVersion=(await db.query(
      "SELECT identity_version_id FROM worker_identity_versions WHERE identity_id=(SELECT identity_id FROM worker_identities WHERE worker_account_id=$1) AND version_number=1",
      [worker.accountId]
    )).rows[0].identity_version_id;
    assert.equal((await db.query(
      "SELECT count(*)::int n FROM worker_identity_worker_ids WHERE worker_account_id=$1",
      [worker.accountId]
    )).rows[0].n,0,"CHANGES_REQUESTED cannot issue a permanent identity before correction.");
    await assertWorkerDecisionNotice(task.taskId,"evidence.additional.requested",firstVersion);
    const { DatabaseWorkerIdentityRepository }=await import(pathToFileURL(join(runtime,"identity","worker-identity-repository.js")).href);
    const repository=new DatabaseWorkerIdentityRepository(Promise.resolve(db));
    const before=await repository.loadOwn(worker);
    const original=(await db.query("SELECT * FROM worker_identity_version_drafts WHERE identity_version_id=$1",[before.currentVersion.identityVersionId])).rows[0];
    await assert.rejects(repository.reviseOwn(verifier,before.identity.lockVersion));
    await assert.rejects(repository.reviseOwn(worker,before.identity.lockVersion-1));
    await assert.rejects(db.query("UPDATE worker_identities SET lifecycle_status='draft',lock_version=lock_version+1 WHERE identity_id=$1",[before.identity.identityId]));
    await assert.rejects(db.query("UPDATE worker_identity_version_drafts SET legal_first_name='Tampered',draft_revision=draft_revision+1 WHERE identity_version_id=$1",[before.currentVersion.identityVersionId]));
    const revision=await repository.reviseOwn(worker,before.identity.lockVersion);
    assert.equal(revision.identity.lifecycleStatus,"draft");assert.equal(revision.currentVersion.versionNumber,2);
    assert.equal(revision.currentVersion.parentVersionId,before.currentVersion.identityVersionId);
    assert.deepEqual((await db.query("SELECT * FROM worker_identity_version_drafts WHERE identity_version_id=$1",[before.currentVersion.identityVersionId])).rows[0],original);
    assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM worker_identity_evidence_bindings WHERE identity_version_id=$1 AND binding_status='active'",[revision.currentVersion.identityVersionId])).rows[0].count,3);
    await assert.rejects(repository.reviseOwn(worker,before.identity.lockVersion));
    await assert.rejects(db.execute(down),/history exists/);
    await repository.submitOwn(worker,revision.identity.lockVersion);
    await db.query("UPDATE worker_identities SET lifecycle_status='automated_checks',lock_version=lock_version+1 WHERE identity_id=$1",[revision.identity.identityId]);
    await db.query("UPDATE worker_identities SET lifecycle_status='manual_review',lock_version=lock_version+1 WHERE identity_id=$1",[revision.identity.identityId]);
    const revisedTask=await service.queueIndependentIdentity(worker,NOW_DATE);
    assert.notEqual(revisedTask.taskId,task.taskId);
    await authorizeAndClaim(db,service,verifier,revisedTask.taskId,NOW_DATE);
    await service.decide(verifier,revisedTask.taskId,"APPROVED","Corrected initial identity evidence was independently verified.",NOW_DATE);
    await assertWorkerDecisionNotice(revisedTask.taskId,"evidence.reviewed",revision.currentVersion.identityVersionId);
    assert.equal(decisionNotices.length,2);
    assert.notEqual(decisionNotices[0].eventRef,decisionNotices[1].eventRef);
    assert.notEqual(decisionNotices[0].jobId,decisionNotices[1].jobId);
    const allNotices=(await db.query(
      "SELECT source_job_id,recipient_role,target_key,target_reference FROM platform_notifications "+
      "WHERE source_job_id IN ($1,$2)",
      [decisionNotices[0].jobId,decisionNotices[1].jobId]
    )).rows;
    assert.equal(allNotices.length,2,"Both independently accepted outcomes must retain one immutable Worker notice.");
    assert.ok(allNotices.every(n=>n.recipient_role==="worker"&&n.target_key==="worker.identity.record"));
    const originalAndCorrected=(await db.query(
      "SELECT identity_version_id,version_number,parent_version_id,version_status,submitted_at FROM worker_identity_versions "+
      "WHERE identity_id=(SELECT identity_id FROM worker_identities WHERE worker_account_id=$1) ORDER BY version_number",
      [worker.accountId]
    )).rows;
    assert.equal(originalAndCorrected.length,2);
    assert.deepEqual(originalAndCorrected.map(v=>v.version_status),["submitted","submitted"]);
    assert.ok(originalAndCorrected.every(v=>v.submitted_at));
    assert.equal(originalAndCorrected[1].parent_version_id,originalAndCorrected[0].identity_version_id);
    console.log("M10704_CHANGES_REQUESTED_APPROVED_WORKER_NOTIFICATIONS_DB",
      "original v1 CHANGES_REQUESTED and corrected submitted v2 APPROVED each own one Worker-only private identity notice and intended email event; no ID before final approval");
    console.log("M10704_REPLAY_SAFETY_DB",
      "both official in-app source projections replay without duplicate, two immutable decisions/versions remain with exact parent link");
    assert.equal((await repository.loadOwn(worker)).identity.lifecycleStatus,"verified");
    assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM worker_identity_worker_ids WHERE worker_account_id=$1",[worker.accountId])).rows[0].count,1);
    await assert.rejects(repository.reviseOwn(worker,(await repository.loadOwn(worker)).identity.lockVersion));
  } finally { await db.close(); }
});

test("Unable-to-verify initial identity becomes revisable more-info without issuing permanent identity",async()=>{
 const db=await database("0108_review_resolution_notifications");try{
 const worker=await seedAccount(db,{accountId:"account_neutral_identity_worker",email:"neutral-worker@example.test",role:"worker",sessionId:"session_neutral_identity_worker"});
 const verifier=await seedAccount(db,{accountId:"account_neutral_identity_verifier",email:"neutral-verifier@example.test",role:"verifier",sessionId:"session_neutral_identity_verifier"});
 await seedManualReviewIdentity(db,worker.accountId);const service=new EvidenceReviewService(db),task=await service.queueIndependentIdentity(worker,NOW_DATE);await authorizeAndClaim(db,service,verifier,task.taskId,NOW_DATE);
 await service.resolveReview(verifier,task.taskId,{expectedRevision:0,outcome:"UNABLE_TO_VERIFY",reason:"The issuer could not confirm the identity record.",attemptedMethods:"Contacted the issuing authority and checked available records.",limitations:"The available records do not establish the submitted identity."},NOW_DATE);
 assert.equal((await db.query("SELECT lifecycle_status FROM worker_identities WHERE worker_account_id=$1",[worker.accountId])).rows[0].lifecycle_status,"more_info");
 assert.equal((await db.query("SELECT count(*)::int total FROM worker_identity_worker_ids WHERE worker_account_id=$1",[worker.accountId])).rows[0].total,0);
 const {DatabaseWorkerIdentityRepository}=await import(pathToFileURL(join(runtime,"identity","worker-identity-repository.js")).href);
 const repository=new DatabaseWorkerIdentityRepository(Promise.resolve(db)),before=await repository.loadOwn(worker);
 const revision=await repository.reviseOwn(worker,before.identity.lockVersion);assert.equal(revision.currentVersion.parentVersionId,before.currentVersion.identityVersionId);
 await repository.submitOwn(worker,revision.identity.lockVersion);
 await db.query("UPDATE worker_identities SET lifecycle_status='automated_checks',lock_version=lock_version+1 WHERE identity_id=$1",[revision.identity.identityId]);
 await db.query("UPDATE worker_identities SET lifecycle_status='manual_review',lock_version=lock_version+1 WHERE identity_id=$1",[revision.identity.identityId]);
 const nextTask=await service.queueIndependentIdentity(worker,NOW_DATE);assert.notEqual(nextTask.taskId,task.taskId);
 assert.equal((await db.query("SELECT outcome FROM evidence_review_resolution_events WHERE task_id=$1",[task.taskId])).rows[0].outcome,"UNABLE_TO_VERIFY");

 }finally{await db.close();}
});

test("Unable-to-verify identity correction preserves the verified original and permits a new correction request",async()=>{
 const db=await database("0108_review_resolution_notifications");try{
 const worker=await seedAccount(db,{accountId:"account_neutral_correction_worker",email:"neutral-correction-worker@example.test",role:"worker",sessionId:"session_neutral_correction_worker"});
 const verifier=await seedAccount(db,{accountId:"account_neutral_correction_verifier",email:"neutral-correction-verifier@example.test",role:"verifier",sessionId:"session_neutral_correction_verifier"});
 await seedManualReviewIdentity(db,worker.accountId);const service=new EvidenceReviewService(db);
 const initial=await service.queueIndependentIdentity(worker,NOW_DATE);await authorizeAndClaim(db,service,verifier,initial.taskId,NOW_DATE);await service.decide(verifier,initial.taskId,"APPROVED","Original identity evidence was independently verified.",NOW_DATE);
 const original=(await db.query("SELECT current_version_number,lock_version FROM worker_identities WHERE worker_account_id=$1",[worker.accountId])).rows[0];
 const permanentId=(await db.query("SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",[worker.accountId])).rows[0].permanent_worker_id;
 const {DatabaseWorkerIdentityCorrectionRepository}=await import(pathToFileURL(join(runtime,"identity","worker-identity-correction-repository.js")).href);
 const corrections=new DatabaseWorkerIdentityCorrectionRepository(Promise.resolve(db));
 await corrections.requestOwn(worker,{reason:"Correct the spelling against preserved identity records.",expectedLockVersion:Number(original.lock_version)});
 let state=(await db.query("SELECT lock_version FROM worker_identities WHERE worker_account_id=$1",[worker.accountId])).rows[0];await corrections.submitOwn(worker,Number(state.lock_version));
 const task=await service.queueIndependentIdentity(worker,NOW_DATE);await authorizeAndClaim(db,service,verifier,task.taskId,NOW_DATE);
 await service.resolveReview(verifier,task.taskId,{expectedRevision:0,outcome:"UNABLE_TO_VERIFY",reason:"The issuer could not independently confirm the proposed correction.",attemptedMethods:"Checked original identity records and contacted the issuer.",limitations:"Issuer could not confirm the revised spelling at this time."},NOW_DATE);
 const after=(await db.query("SELECT lifecycle_status,current_version_number,lock_version FROM worker_identities WHERE worker_account_id=$1",[worker.accountId])).rows[0];
 assert.equal(after.lifecycle_status,"verified");assert.equal(after.current_version_number,original.current_version_number);
 assert.equal((await db.query("SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",[worker.accountId])).rows[0].permanent_worker_id,permanentId);
 const history=await corrections.loadOwn(worker);assert.equal(history.decision,"rejected");
 assert.equal((await db.query("SELECT count(*)::int total FROM evidence_review_decisions WHERE task_id=$1",[task.taskId])).rows[0].total,0);
 await corrections.requestOwn(worker,{reason:"Provide additional issuer records for a fresh correction.",expectedLockVersion:Number(after.lock_version)});
 }finally{await db.close();}
});

test("M1.07.03 rejected initial identity routes one immutable Worker notification without duplicate recipients",async()=>{
 const db=await database();
 try{
  const worker=await seedAccount(db,{accountId:"account_m10703_rejected_worker",email:"m10703-rejected-worker@example.test",role:"worker",sessionId:"session_m10703_rejected_worker"});
  const verifier=await seedAccount(db,{accountId:"account_m10703_rejected_verifier",email:"m10703-rejected-verifier@example.test",role:"verifier",sessionId:"session_m10703_rejected_verifier"});
  await seedManualReviewIdentity(db,worker.accountId);
  const service=new EvidenceReviewService(db);
  const task=await service.queueIndependentIdentity(worker,NOW_DATE);
  await authorizeAndClaim(db,service,verifier,task.taskId,NOW_DATE);
  const reason="Independent checks cannot establish the claimed initial identity.";
  await service.decide(verifier,task.taskId,"REJECTED",reason,NOW_DATE);
  const identity=(await db.query("SELECT identity_id,lifecycle_status,current_version_number FROM worker_identities WHERE worker_account_id=$1",[worker.accountId])).rows[0];
  assert.equal(identity.lifecycle_status,"rejected");
  assert.equal(identity.current_version_number,1);
  const versions=(await db.query("SELECT identity_version_id,version_status,submitted_at FROM worker_identity_versions WHERE identity_id=$1",[identity.identity_id])).rows;
  assert.equal(versions.length,1);assert.equal(versions[0].version_status,"submitted");assert.ok(versions[0].submitted_at);
  const decision=(await db.query("SELECT decision_id,outcome,reason,source_version_id,verifier_account_id FROM evidence_review_decisions WHERE task_id=$1",[task.taskId])).rows[0];
  assert.equal(decision.outcome,"REJECTED");assert.equal(decision.reason,reason);
  assert.equal(decision.source_version_id,versions[0].identity_version_id);
  assert.equal(decision.verifier_account_id,verifier.accountId);
  assert.equal((await db.query("SELECT count(*)::int n FROM worker_identity_worker_ids WHERE worker_account_id=$1",[worker.accountId])).rows[0].n,0);
  const eventRef="review:"+decision.decision_id;
  const jobs=(await db.query("SELECT job_id,job_type,payload FROM platform_outbox_jobs WHERE job_type IN ('notification.assurance.event','email.assurance.event') AND payload->>'eventType'='evidence.reviewed' AND payload->>'eventRef'=$1",[eventRef])).rows;
  const inApp=jobs.filter(j=>j.job_type==="notification.assurance.event");
  const emails=jobs.filter(j=>j.job_type==="email.assurance.event");
  assert.equal(inApp.length,1);assert.ok(emails.length>=1);
  console.log("M10703_REJECTED_OUTCOME_NOTIFICATION_INTENT_DB","original Verifier rejection, immutable initial identity, no Worker ID, one in-app and intended email event");
  const first=(await db.query("SELECT created,suppressed FROM platform_project_assurance_event_notification($1)",[inApp[0].job_id])).rows[0];
  assert.deepEqual(first,{created:1,suppressed:false});
  const notices=(await db.query("SELECT notification_type,recipient_account_id,recipient_role,tenant_id,membership_id,target_key,target_reference,title,metadata,read_at FROM platform_notifications WHERE source_job_id=$1",[inApp[0].job_id])).rows;
  assert.equal(notices.length,1);
  const notice=notices[0];
  assert.equal(notice.notification_type,"evidence.reviewed");
  assert.equal(notice.recipient_account_id,worker.accountId);
  assert.equal(notice.recipient_role,"worker");
  assert.equal(notice.tenant_id,null);assert.equal(notice.membership_id,null);
  assert.equal(notice.target_key,"worker.identity.record");
  assert.equal(notice.target_reference,identity.identity_id);
  assert.equal(notice.title,"Evidence review recorded");
  assert.equal(notice.read_at,null);assert.equal(notice.metadata.eventRef,eventRef);
  const replay=(await db.query("SELECT created,suppressed FROM platform_project_assurance_event_notification($1)",[inApp[0].job_id])).rows[0];
  assert.deepEqual(replay,{created:0,suppressed:false});
  assert.equal((await db.query("SELECT count(*)::int n FROM platform_notifications WHERE source_job_id=$1",[inApp[0].job_id])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM evidence_review_decisions WHERE task_id=$1",[task.taskId])).rows[0].n,1);
  console.log("M10703_REJECTED_WORKER_PRIVATE_NOTICE_REPLAY_DB","exact Worker-only identity link and recipient, zero Verifier/Admin/tenant leak, replay idempotent, original decision unchanged");
 }finally{await db.close();}
});

// M1.11.01 adds a qualification-specific review conflict on actual two-client
// PostgreSQL16. Earlier real signed browser tests already cover file upload,
// Verifier CHANGES_REQUESTED/REJECTED, Worker correction and approved receiving
// UI; this is deliberately narrower to avoid duplicating old passing journeys.
async function m11101QualificationSqlClients(connectionOverride) {
  const connection=connectionOverride || process.env.HSE_M11101_POSTGRES_TEST_DATABASE_URL;
  if (!connection) {
    const db=await database("0134_company_worker_placement_audit");
    return {first:db,second:db,postgres:false,dispose:async()=>db.close()};
  }
  const parsed=new URL(connection);
  assert.match(parsed.hostname,/^(127\.0\.0\.1|localhost)$/,"Only isolated loopback PostgreSQL allowed");
  const admin=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:connection});
  const name="m11101_qualification_"+Date.now()+"_"+process.pid;
  let first,second,created=false;
  try{
    await admin.execute('CREATE DATABASE "'+name+'"');created=true;
    parsed.pathname="/"+name;
    first=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:parsed.href});
    second=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:parsed.href});
    await applyMigrationsThrough(first,"m11101-qual-correction-two-client-pg16","0134_company_worker_placement_audit");
    return {first,second,postgres:true,dispose:async()=>{
      try{await second.close();await first.close();}
      finally{try{await admin.execute('DROP DATABASE "'+name+'"');}finally{await admin.close();}}
    }};
  }catch(error){
    if(second)await second.close();
    if(first)await first.close();
    try{if(created)await admin.execute('DROP DATABASE "'+name+'"');}
    finally{await admin.close();}
    throw error;
  }
}

test("M1.11.01 qualification two-source review race and stale-Verifier denial on PGlite and actual PostgreSQL16",{
  timeout:220000
},async()=>{
  const {first,second,postgres,dispose}=await m11101QualificationSqlClients();
  const evidence=new EvidenceReviewService(first),competitor=new EvidenceReviewService(second);
  const mark=(s)=>console.log((postgres?"M11101_ACTUAL_PG16_":"M11101_PGLITE_")+s);
  try{
    const worker=await seedAccount(first,{
      accountId:"account_m11101_qual_worker",
      email:"m11101-worker@example.test",role:"worker",sessionId:"session_m11101_worker"
    });
    const verifier=await seedAccount(first,{
      accountId:"account_m11101_qual_verifier",
      email:"m11101-verifier@example.test",role:"verifier",sessionId:"session_m11101_verifier"
    });
    const extra=async(role,suffix)=>{
      const accountId="account_m11101_other_"+suffix;
      const sessionId="session_m11101_other_"+suffix;
      const email="m11101-"+suffix+"@example.test";
      await first.query("INSERT INTO auth_accounts "+
        "(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) "+
        "VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)",[
        accountId,email,"M11101 "+suffix,"scrypt$16384$8$1$salt$hash",NOW
      ]);
      await first.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[
        accountId,role,NOW
      ]);
      await first.query("INSERT INTO auth_sessions "+
        "(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) "+
        "VALUES($1,$2,$3,$4,$5,$6,$6,$7)",[
        sessionId,accountId,role,"m11101-token-"+suffix,"m11101-csrf-"+suffix,NOW,FUTURE
      ]);
      return {accountId,sessionId,activeRole:role,accountStatus:"active",
        email,displayName:"M11101 "+suffix,createdAt:NOW,lastSeenAt:NOW,
        expiresAt:FUTURE,tenantMembership:null};
    };
    const foreignWorker=await extra("worker","wrong-worker");
    const otherVerifier=await extra("verifier","wrong-verifier");
    const companyRole=await extra("company","company-role");
    const q=await seedEvidence(first,worker.accountId,"qualification","Q");
    const taskV1=await evidence.queueIndependentWorkerEvidence(worker,q.recordId,NOW_DATE);
    await assert.rejects(evidence.queueIndependentWorkerEvidence(foreignWorker,q.recordId,NOW_DATE),
      e=>e?.name==="EvidenceReviewConflictError");
    await assert.rejects(evidence.claim(companyRole,taskV1.taskId,NOW_DATE),
      e=>e?.name==="EvidenceReviewAccessError");
    await authorizeAndClaim(first,evidence,verifier,taskV1.taskId,NOW_DATE);
    await assert.rejects(competitor.decide(otherVerifier,taskV1.taskId,"APPROVED",
      "Copied review task identifier cannot confer assigned-review permission.",NOW_DATE),
      e=>e?.name==="EvidenceReviewAccessError");
    await evidence.decide(verifier,taskV1.taskId,"CHANGES_REQUESTED",
      "Qualification certificate reference needs correction before independent review.",NOW_DATE);
    mark("WRONG_WORKER_COMPANY_ROLE_AND_UNASSIGNED_VERIFIER_DENIED_NO_FORGED_DECISION");

    const revise=async(record,oldVersion,letter)=>{
      const replacement=oid("evidence_version",letter);
      await first.query("UPDATE worker_evidence_versions SET version_status='superseded',updated_at=$2 "+
        "WHERE version_id=$1",[oldVersion,NOW]);
      await first.query("INSERT INTO worker_evidence_versions "+
        "(version_id,record_id,version_number,revision,version_status,supersedes_version_id,created_at,updated_at,submitted_at) "+
        "VALUES($1,$2,2,1,'submitted',$3,$4,$4,$4)",[
        replacement,record,oldVersion,NOW
      ]);
      await first.query("UPDATE worker_evidence_records SET current_version_id=$2,updated_at=$3 "+
        "WHERE record_id=$1",[record,replacement,NOW]);
      return replacement;
    };
    const v2=await revise(q.recordId,q.versionId,"q");
    const taskV2=await evidence.queueIndependentWorkerEvidence(worker,q.recordId,NOW_DATE);
    const replay=await evidence.queueIndependentWorkerEvidence(worker,q.recordId,NOW_DATE);
    assert.equal(replay.taskId,taskV2.taskId);
    assert.notEqual(taskV1.taskId,taskV2.taskId);
    await authorizeReviewFixture(first,{
      taskId:taskV2.taskId,verifiers:[verifier,otherVerifier],at:NOW_DATE
    });
    let winner,loser;
    if(postgres){
      const claims=await Promise.allSettled([
        evidence.claim(verifier,taskV2.taskId,NOW_DATE),
        competitor.claim(otherVerifier,taskV2.taskId,NOW_DATE)
      ]);
      assert.equal(claims.filter(x=>x.status==="fulfilled").length,1,
        "Actual two-client PG16 claim must select exactly one Verifier");
      winner=claims[0].status==="fulfilled"?verifier:otherVerifier;
      loser=winner===verifier?otherVerifier:verifier;
    }else{
      await evidence.claim(verifier,taskV2.taskId,NOW_DATE);
      await assert.rejects(evidence.claim(otherVerifier,taskV2.taskId,NOW_DATE),
        e=>e?.name==="EvidenceReviewAccessError");
      winner=verifier;loser=otherVerifier;
    }
    await assert.rejects(competitor.decide(loser,taskV2.taskId,"APPROVED",
      "Unassigned Verifier may not approve another actor's task.",NOW_DATE),
      e=>e?.name==="EvidenceReviewAccessError");
    const validReason="Corrected qualification v2 source reference and independent evidence are sufficient.";
    if(postgres){
      const decisions=await Promise.allSettled([
        evidence.decide(winner,taskV2.taskId,"APPROVED",validReason,NOW_DATE),
        competitor.decide(winner,taskV2.taskId,"APPROVED",validReason,NOW_DATE)
      ]);
      assert.equal(decisions.filter(x=>x.status==="fulfilled").length,1,
        "Two PostgreSQL16 clients must not finalize the same corrected qualification twice");
    }else{
      await evidence.decide(winner,taskV2.taskId,"APPROVED",validReason,NOW_DATE);
      await assert.rejects(competitor.decide(winner,taskV2.taskId,"APPROVED",validReason,NOW_DATE),
        e=>e?.name==="EvidenceReviewAccessError");
    }
    mark("CORRECTED_QUALIFICATION_V2_ONE_CLAIM_AND_FINALIZE_REPLAYS_DENIED");

    const stale=await seedEvidence(first,worker.accountId,"qualification","R");
    const staleTask=await evidence.queueIndependentWorkerEvidence(worker,stale.recordId,NOW_DATE);
    await authorizeAndClaim(first,evidence,verifier,staleTask.taskId,NOW_DATE);
    const staleCurrent=await revise(stale.recordId,stale.versionId,"r");
    await assert.rejects(competitor.decide(verifier,staleTask.taskId,"APPROVED",
      "Verifier must not approve qualification after Worker changed source version.",NOW_DATE),
      e=>e?.name==="EvidenceReviewConflictError");
    const noStale=(await first.query(
      "SELECT COUNT(*)::int n FROM evidence_review_decisions WHERE task_id=$1",
      [staleTask.taskId])).rows[0].n;
    assert.equal(noStale,0);
    const newStale=await evidence.queueIndependentWorkerEvidence(worker,stale.recordId,NOW_DATE);
    assert.notEqual(newStale.taskId,staleTask.taskId);
    await authorizeAndClaim(first,evidence,verifier,newStale.taskId,NOW_DATE);
    await evidence.decide(verifier,newStale.taskId,"APPROVED",
      "New version of qualification is current and independently verified.",NOW_DATE);
    mark("STALE_ASSIGNED_VERSION_APPROVAL_DENIED_CORRECTED_TASK_APPROVED_NO_STALE_DECISION");

    const rows=(await first.query(
      "SELECT task_id,source_record_id,source_version_id,task_status,assigned_verifier_account_id "+
      "FROM evidence_review_tasks WHERE worker_account_id=$1 AND evidence_kind='qualification' "+
      "ORDER BY source_record_id,source_version_id",[worker.accountId])).rows;
    assert.equal(rows.length,4);
    assert.equal(rows.find(x=>x.task_id===taskV1.taskId).task_status,"CHANGES_REQUESTED");
    assert.equal(rows.find(x=>x.task_id===taskV2.taskId).task_status,"APPROVED");
    assert.equal(rows.find(x=>x.task_id===taskV2.taskId).source_version_id,v2);
    assert.equal(rows.find(x=>x.task_id===staleTask.taskId).task_status,"SUPERSEDED");
    assert.equal(rows.find(x=>x.task_id===newStale.taskId).task_status,"APPROVED");
    assert.equal(rows.find(x=>x.task_id===newStale.taskId).source_version_id,staleCurrent);
    const history=(await first.query(
      "SELECT tasks.task_id,tasks.source_version_id,decisions.outcome,decisions.verifier_account_id,decisions.decision_id "+
      "FROM evidence_review_decisions decisions JOIN evidence_review_tasks tasks ON tasks.task_id=decisions.task_id "+
      "WHERE tasks.worker_account_id=$1 AND tasks.evidence_kind='qualification' ORDER BY tasks.task_id",
      [worker.accountId])).rows;
    assert.equal(history.length,3);
    assert.deepEqual(history.map(x=>x.outcome).sort(),["APPROVED","APPROVED","CHANGES_REQUESTED"]);
    assert.equal(history.find(x=>x.task_id===taskV1.taskId).source_version_id,q.versionId);
    assert.equal(history.find(x=>x.task_id===taskV2.taskId).source_version_id,v2);
    assert.equal(history.find(x=>x.task_id===newStale.taskId).source_version_id,staleCurrent);
    assert(history.every(x=>x.verifier_account_id===verifier.accountId||x.verifier_account_id===otherVerifier.accountId));
    const original=(await first.query(
      "SELECT version_id,version_status FROM worker_evidence_versions WHERE record_id=$1 ORDER BY version_number",
      [q.recordId])).rows;
    assert.deepEqual(original,[
      {version_id:q.versionId,version_status:"superseded"},
      {version_id:v2,version_status:"submitted"}
    ]);
    assert.equal((await first.query("SELECT count(*)::int n FROM auth_accounts WHERE account_id=$1",
      [worker.accountId])).rows[0].n,1);
    await assert.rejects(first.query(
      "UPDATE evidence_review_decisions SET reason='altered after review' WHERE decision_id=$1",
      [history[0].decision_id]),e=>e?.code==="55000");
    mark("EXACT_THREE_IMMUTABLE_VERSION_BOUND_QUALIFICATION_DECISIONS_ONE_WORKER_NO_FOREIGN_ACCESS");
  }finally{await dispose();}
});


test("M1.11.02 experience correction retains old review and rejects stale, foreign and simultaneous Verifier decisions on actual PostgreSQL16",{
 timeout:220000
},async()=>{
 const {first,second,postgres,dispose}=await m11101QualificationSqlClients(process.env.HSE_M11102_POSTGRES_TEST_DATABASE_URL);
 const service=new EvidenceReviewService(first),concurrent=new EvidenceReviewService(second);
 const mark=s=>console.log((postgres?"M11102_ACTUAL_PG16_":"M11102_PGLITE_")+s);
 const stamp=new Date(NOW);
 try{
  const worker=await seedAccount(first,{accountId:"account_m11102_worker",email:"worker-m11102@example.test",role:"worker",sessionId:"session_m11102_worker"});
  const verifierA=await seedAccount(first,{accountId:"account_m11102_verifier_a",email:"verifier-a-m11102@example.test",role:"verifier",sessionId:"session_m11102_verifier_a"});
  const seedAdditional=async(role,suffix)=>{
   const accountId="account_m11102_"+suffix,sessionId="session_m11102_"+suffix,email=suffix+"@m11102.example.test";
   await first.query("INSERT INTO auth_accounts (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)"+
     " VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)",[accountId,email,suffix,"scrypt$16384$8$1$salt$hash",NOW]);
   await first.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[accountId,role,NOW]);
   await first.query("INSERT INTO auth_sessions (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)"+
     " VALUES($1,$2,$3,$4,$5,$6,$6,$7)",[sessionId,accountId,role,"token-"+suffix,"csrf-"+suffix,NOW,FUTURE]);
   return {accountId,sessionId,activeRole:role,accountStatus:"active",email,displayName:suffix,
     createdAt:NOW,lastSeenAt:NOW,expiresAt:FUTURE,tenantMembership:null};
  };
  const verifierB=await seedAdditional("verifier","verifier_b");
  const foreignWorker=await seedAdditional("worker","foreign_worker");
  const company=await seedAccount(first,{accountId:"account_m11102_company",email:"company-m11102@example.test",role:"company",sessionId:"session_m11102_company"});
  const original=await seedEvidence(first,worker.accountId,"experience","E");
  const oldTask=await service.queueIndependentWorkerEvidence(worker,original.recordId,stamp);
  await assert.rejects(service.queueIndependentWorkerEvidence(foreignWorker,original.recordId,stamp),e=>e?.name==="EvidenceReviewConflictError");
  await assert.rejects(service.claim(company,oldTask.taskId,stamp),e=>e?.name==="EvidenceReviewAccessError");
  await authorizeAndClaim(first,service,verifierA,oldTask.taskId,stamp);
  await assert.rejects(concurrent.decide(verifierB,oldTask.taskId,"APPROVED",
   "A copied task ID cannot authorize another Verifier to change an experience outcome.",stamp),
    e=>e?.name==="EvidenceReviewAccessError");
  await service.decide(verifierA,oldTask.taskId,"CHANGES_REQUESTED",
   "Original experience duties evidence needs a specific corrected account before approval.",stamp);
  mark("FOREIGN_WORKER_COMPANY_ROLE_AND_COPIED_VERIFIER_TASK_DENIED");

  const revise=async(recordId,versionId,letter)=>{
   const corrected=oid("evidence_version",letter);
   await first.query("UPDATE worker_evidence_versions SET version_status='superseded',updated_at=$2 WHERE version_id=$1",
     [versionId,NOW]);
   await first.query("INSERT INTO worker_evidence_versions"+
     " (version_id,record_id,version_number,revision,version_status,supersedes_version_id,created_at,updated_at,submitted_at)"+
     " VALUES($1,$2,2,1,'submitted',$3,$4,$4,$4)",[corrected,recordId,versionId,NOW]);
   await first.query("UPDATE worker_evidence_records SET current_version_id=$2,updated_at=$3 WHERE record_id=$1",
     [recordId,corrected,NOW]);
   return corrected;
  };
  const correctedId=await revise(original.recordId,original.versionId,"e");
  const corrected=await service.queueIndependentWorkerEvidence(worker,original.recordId,stamp);
  assert.equal((await service.queueIndependentWorkerEvidence(worker,original.recordId,stamp)).taskId,corrected.taskId);
  assert.notEqual(corrected.taskId,oldTask.taskId);
  await authorizeReviewFixture(first,{taskId:corrected.taskId,verifiers:[verifierA,verifierB],at:stamp});
  let winner=verifierA,loser=verifierB;
  if(postgres){
   const raced=await Promise.allSettled([
     service.claim(verifierA,corrected.taskId,stamp),
     concurrent.claim(verifierB,corrected.taskId,stamp)
   ]);
   assert.equal(raced.filter(r=>r.status==="fulfilled").length,1,"Only one live Verifier can claim corrected experience on two SQL clients");
   winner=raced[0].status==="fulfilled"?verifierA:verifierB;
   loser=winner===verifierA?verifierB:verifierA;
  }else{
   await service.claim(verifierA,corrected.taskId,stamp);
   await assert.rejects(service.claim(verifierB,corrected.taskId,stamp),e=>e?.name==="EvidenceReviewAccessError");
  }
  await assert.rejects(concurrent.decide(loser,corrected.taskId,"APPROVED",
   "Unassigned competing reviewer cannot finalize this corrected experience.",stamp),
   e=>e?.name==="EvidenceReviewAccessError");
  const reason="Corrected experience duties and attributable evidence are adequate for an independent approval.";
  if(postgres){
   const raced=await Promise.allSettled([
     service.decide(winner,corrected.taskId,"APPROVED",reason,stamp),
     concurrent.decide(winner,corrected.taskId,"APPROVED",reason,stamp)
   ]);
   assert.equal(raced.filter(r=>r.status==="fulfilled").length,1,"Only one corrected experience decision can commit on two SQL clients");
  }else{
   await service.decide(winner,corrected.taskId,"APPROVED",reason,stamp);
   await assert.rejects(concurrent.decide(winner,corrected.taskId,"APPROVED",reason,stamp),
     e=>e?.name==="EvidenceReviewAccessError");
  }
  mark("CORRECTED_V2_REQUEUED_ONCE_ONLY_AUTHORIZED_VERIFIER_FINALIZES");

  const staleEvidence=await seedEvidence(first,worker.accountId,"experience","F");
  const staleTask=await service.queueIndependentWorkerEvidence(worker,staleEvidence.recordId,stamp);
  await authorizeAndClaim(first,service,verifierA,staleTask.taskId,stamp);
  const replacement=await revise(staleEvidence.recordId,staleEvidence.versionId,"f");
  await assert.rejects(concurrent.decide(verifierA,staleTask.taskId,"APPROVED",
    "Stale earlier experience source can no longer be approved after Worker replacement.",stamp),
    e=>e?.name==="EvidenceReviewConflictError");
  assert.equal((await first.query("SELECT COUNT(*)::int n FROM evidence_review_decisions WHERE task_id=$1",
    [staleTask.taskId])).rows[0].n,0);
  const activeTask=await service.queueIndependentWorkerEvidence(worker,staleEvidence.recordId,stamp);
  await authorizeAndClaim(first,service,verifierA,activeTask.taskId,stamp);
  await service.decide(verifierA,activeTask.taskId,"APPROVED",
   "Current corrected Worker experience is attributable, traceable and suitable for approval.",stamp);
  mark("STALE_VERIFIER_DECISION_REFUSED_WITH_ZERO_STALE_DECISIONS_CORRECTED_SOURCE_ACCEPTED");

  const tasks=(await first.query("SELECT task_id,source_version_id,source_record_id,task_status,worker_account_id"+
    " FROM evidence_review_tasks WHERE worker_account_id=$1 AND evidence_kind='experience'",
    [worker.accountId])).rows;
  assert.equal(tasks.length,4);
  for(const [ref,version,status] of [
   [oldTask.taskId,original.versionId,"CHANGES_REQUESTED"],
   [corrected.taskId,correctedId,"APPROVED"],
   [staleTask.taskId,staleEvidence.versionId,"SUPERSEDED"],
   [activeTask.taskId,replacement,"APPROVED"]
  ]){
   const row=tasks.find(x=>x.task_id===ref);
   assert.equal(row?.source_version_id,version);
   assert.equal(row?.task_status,status);
   assert.equal(row?.worker_account_id,worker.accountId);
  }
  const decisions=(await first.query("SELECT d.decision_id,d.source_version_id,d.outcome,d.verifier_account_id,t.task_id"+
    " FROM evidence_review_decisions d JOIN evidence_review_tasks t ON t.task_id=d.task_id"+
    " WHERE t.worker_account_id=$1 AND t.evidence_kind='experience' ORDER BY t.task_id",
    [worker.accountId])).rows;
  assert.equal(decisions.length,3);
  assert.deepEqual(decisions.map(x=>x.outcome).sort(),["APPROVED","APPROVED","CHANGES_REQUESTED"]);
  assert.equal(decisions.find(x=>x.task_id===oldTask.taskId).source_version_id,original.versionId);
  assert.equal(decisions.find(x=>x.task_id===corrected.taskId).source_version_id,correctedId);
  assert.equal(decisions.find(x=>x.task_id===activeTask.taskId).source_version_id,replacement);
  const versions=(await first.query("SELECT version_id,version_status FROM worker_evidence_versions"+
    " WHERE record_id=$1 ORDER BY version_number",[original.recordId])).rows;
  assert.deepEqual(versions,[{version_id:original.versionId,version_status:"superseded"},
    {version_id:correctedId,version_status:"submitted"}]);
  assert.equal((await first.query("SELECT COUNT(*)::int n FROM auth_accounts WHERE account_id=$1",
    [worker.accountId])).rows[0].n,1);
  assert.equal((await first.query("SELECT COUNT(*)::int n FROM evidence_review_decisions WHERE task_id=$1",
    [staleTask.taskId])).rows[0].n,0);
  await assert.rejects(first.query("UPDATE evidence_review_decisions SET reason='tampered' WHERE decision_id=$1",
    [decisions[0].decision_id]),e=>e?.code==="55000");
  mark("IMMUTABLE_ORIGINAL_AND_CORRECTED_EXPERIENCE_VERSIONS_THREE_BOUND_DECISIONS_ONE_WORKER");
 }finally{await dispose();}
});


test("M1.11.03 skill correction retains old review and rejects stale, foreign and simultaneous Verifier decisions on actual PostgreSQL16",{
 timeout:220000
},async()=>{
 const {first,second,postgres,dispose}=await m11101QualificationSqlClients(process.env.HSE_M11103_POSTGRES_TEST_DATABASE_URL);
 const service=new EvidenceReviewService(first),concurrent=new EvidenceReviewService(second);
 const mark=s=>console.log((postgres?"M11103_ACTUAL_PG16_":"M11103_PGLITE_")+s);
 const stamp=new Date(NOW);
 try{
  const worker=await seedAccount(first,{accountId:"account_m11103_worker",email:"worker-m11103@example.test",role:"worker",sessionId:"session_m11103_worker"});
  const verifierA=await seedAccount(first,{accountId:"account_m11103_verifier_a",email:"verifier-a-m11103@example.test",role:"verifier",sessionId:"session_m11103_verifier_a"});
  const seedAdditional=async(role,suffix)=>{
   const accountId="account_m11103_"+suffix,sessionId="session_m11103_"+suffix,email=suffix+"@m11103.example.test";
   await first.query("INSERT INTO auth_accounts (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)"+
     " VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)",[accountId,email,suffix,"scrypt$16384$8$1$salt$hash",NOW]);
   await first.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[accountId,role,NOW]);
   await first.query("INSERT INTO auth_sessions (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)"+
     " VALUES($1,$2,$3,$4,$5,$6,$6,$7)",[sessionId,accountId,role,"token-"+suffix,"csrf-"+suffix,NOW,FUTURE]);
   return {accountId,sessionId,activeRole:role,accountStatus:"active",email,displayName:suffix,
     createdAt:NOW,lastSeenAt:NOW,expiresAt:FUTURE,tenantMembership:null};
  };
  const verifierB=await seedAdditional("verifier","verifier_b");
  const foreignWorker=await seedAdditional("worker","foreign_worker");
  const company=await seedAccount(first,{accountId:"account_m11103_company",email:"company-m11103@example.test",role:"company",sessionId:"session_m11103_company"});
  const original=await seedEvidence(first,worker.accountId,"skill","E");
  const oldTask=await service.queueIndependentWorkerEvidence(worker,original.recordId,stamp);
  await assert.rejects(service.queueIndependentWorkerEvidence(foreignWorker,original.recordId,stamp),e=>e?.name==="EvidenceReviewConflictError");
  await assert.rejects(service.claim(company,oldTask.taskId,stamp),e=>e?.name==="EvidenceReviewAccessError");
  await authorizeAndClaim(first,service,verifierA,oldTask.taskId,stamp);
  await assert.rejects(concurrent.decide(verifierB,oldTask.taskId,"APPROVED",
   "A copied task ID cannot authorize another Verifier to change an skill outcome.",stamp),
    e=>e?.name==="EvidenceReviewAccessError");
  await service.decide(verifierA,oldTask.taskId,"CHANGES_REQUESTED",
   "Original skill duties evidence needs a specific corrected account before approval.",stamp);
  mark("FOREIGN_WORKER_COMPANY_ROLE_AND_COPIED_VERIFIER_TASK_DENIED");

  const revise=async(recordId,versionId,letter)=>{
   const corrected=oid("evidence_version",letter);
   await first.query("UPDATE worker_evidence_versions SET version_status='superseded',updated_at=$2 WHERE version_id=$1",
     [versionId,NOW]);
   await first.query("INSERT INTO worker_evidence_versions"+
     " (version_id,record_id,version_number,revision,version_status,supersedes_version_id,created_at,updated_at,submitted_at)"+
     " VALUES($1,$2,2,1,'submitted',$3,$4,$4,$4)",[corrected,recordId,versionId,NOW]);
   await first.query("UPDATE worker_evidence_records SET current_version_id=$2,updated_at=$3 WHERE record_id=$1",
     [recordId,corrected,NOW]);
   return corrected;
  };
  const correctedId=await revise(original.recordId,original.versionId,"e");
  const corrected=await service.queueIndependentWorkerEvidence(worker,original.recordId,stamp);
  assert.equal((await service.queueIndependentWorkerEvidence(worker,original.recordId,stamp)).taskId,corrected.taskId);
  assert.notEqual(corrected.taskId,oldTask.taskId);
  await authorizeReviewFixture(first,{taskId:corrected.taskId,verifiers:[verifierA,verifierB],at:stamp});
  let winner=verifierA,loser=verifierB;
  if(postgres){
   const raced=await Promise.allSettled([
     service.claim(verifierA,corrected.taskId,stamp),
     concurrent.claim(verifierB,corrected.taskId,stamp)
   ]);
   assert.equal(raced.filter(r=>r.status==="fulfilled").length,1,"Only one live Verifier can claim corrected skill on two SQL clients");
   winner=raced[0].status==="fulfilled"?verifierA:verifierB;
   loser=winner===verifierA?verifierB:verifierA;
  }else{
   await service.claim(verifierA,corrected.taskId,stamp);
   await assert.rejects(service.claim(verifierB,corrected.taskId,stamp),e=>e?.name==="EvidenceReviewAccessError");
  }
  await assert.rejects(concurrent.decide(loser,corrected.taskId,"APPROVED",
   "Unassigned competing reviewer cannot finalize this corrected skill.",stamp),
   e=>e?.name==="EvidenceReviewAccessError");
  const reason="Corrected skill duties and attributable evidence are adequate for an independent approval.";
  if(postgres){
   const raced=await Promise.allSettled([
     service.decide(winner,corrected.taskId,"APPROVED",reason,stamp),
     concurrent.decide(winner,corrected.taskId,"APPROVED",reason,stamp)
   ]);
   assert.equal(raced.filter(r=>r.status==="fulfilled").length,1,"Only one corrected skill decision can commit on two SQL clients");
  }else{
   await service.decide(winner,corrected.taskId,"APPROVED",reason,stamp);
   await assert.rejects(concurrent.decide(winner,corrected.taskId,"APPROVED",reason,stamp),
     e=>e?.name==="EvidenceReviewAccessError");
  }
  mark("CORRECTED_V2_REQUEUED_ONCE_ONLY_AUTHORIZED_VERIFIER_FINALIZES");

  const staleEvidence=await seedEvidence(first,worker.accountId,"skill","F");
  const staleTask=await service.queueIndependentWorkerEvidence(worker,staleEvidence.recordId,stamp);
  await authorizeAndClaim(first,service,verifierA,staleTask.taskId,stamp);
  const replacement=await revise(staleEvidence.recordId,staleEvidence.versionId,"f");
  await assert.rejects(concurrent.decide(verifierA,staleTask.taskId,"APPROVED",
    "Stale earlier skill source can no longer be approved after Worker replacement.",stamp),
    e=>e?.name==="EvidenceReviewConflictError");
  assert.equal((await first.query("SELECT COUNT(*)::int n FROM evidence_review_decisions WHERE task_id=$1",
    [staleTask.taskId])).rows[0].n,0);
  const activeTask=await service.queueIndependentWorkerEvidence(worker,staleEvidence.recordId,stamp);
  await authorizeAndClaim(first,service,verifierA,activeTask.taskId,stamp);
  await service.decide(verifierA,activeTask.taskId,"APPROVED",
   "Current corrected Worker skill is attributable, traceable and suitable for approval.",stamp);
  mark("STALE_VERIFIER_DECISION_REFUSED_WITH_ZERO_STALE_DECISIONS_CORRECTED_SOURCE_ACCEPTED");

  const tasks=(await first.query("SELECT task_id,source_version_id,source_record_id,task_status,worker_account_id"+
    " FROM evidence_review_tasks WHERE worker_account_id=$1 AND evidence_kind='skill'",
    [worker.accountId])).rows;
  assert.equal(tasks.length,4);
  for(const [ref,version,status] of [
   [oldTask.taskId,original.versionId,"CHANGES_REQUESTED"],
   [corrected.taskId,correctedId,"APPROVED"],
   [staleTask.taskId,staleEvidence.versionId,"SUPERSEDED"],
   [activeTask.taskId,replacement,"APPROVED"]
  ]){
   const row=tasks.find(x=>x.task_id===ref);
   assert.equal(row?.source_version_id,version);
   assert.equal(row?.task_status,status);
   assert.equal(row?.worker_account_id,worker.accountId);
  }
  const decisions=(await first.query("SELECT d.decision_id,d.source_version_id,d.outcome,d.verifier_account_id,t.task_id"+
    " FROM evidence_review_decisions d JOIN evidence_review_tasks t ON t.task_id=d.task_id"+
    " WHERE t.worker_account_id=$1 AND t.evidence_kind='skill' ORDER BY t.task_id",
    [worker.accountId])).rows;
  assert.equal(decisions.length,3);
  assert.deepEqual(decisions.map(x=>x.outcome).sort(),["APPROVED","APPROVED","CHANGES_REQUESTED"]);
  assert.equal(decisions.find(x=>x.task_id===oldTask.taskId).source_version_id,original.versionId);
  assert.equal(decisions.find(x=>x.task_id===corrected.taskId).source_version_id,correctedId);
  assert.equal(decisions.find(x=>x.task_id===activeTask.taskId).source_version_id,replacement);
  const versions=(await first.query("SELECT version_id,version_status FROM worker_evidence_versions"+
    " WHERE record_id=$1 ORDER BY version_number",[original.recordId])).rows;
  assert.deepEqual(versions,[{version_id:original.versionId,version_status:"superseded"},
    {version_id:correctedId,version_status:"submitted"}]);
  assert.equal((await first.query("SELECT COUNT(*)::int n FROM auth_accounts WHERE account_id=$1",
    [worker.accountId])).rows[0].n,1);
  assert.equal((await first.query("SELECT COUNT(*)::int n FROM evidence_review_decisions WHERE task_id=$1",
    [staleTask.taskId])).rows[0].n,0);
  await assert.rejects(first.query("UPDATE evidence_review_decisions SET reason='tampered' WHERE decision_id=$1",
    [decisions[0].decision_id]),e=>e?.code==="55000");
  mark("IMMUTABLE_ORIGINAL_AND_CORRECTED_SKILL_VERSIONS_THREE_BOUND_DECISIONS_ONE_WORKER");
 }finally{await dispose();}
});
