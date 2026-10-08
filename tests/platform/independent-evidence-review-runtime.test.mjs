import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

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

async function database(through = "0062_independent_review_backfill") {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, through);
  return db;
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

    await service.claim(verifier, qualificationTask.taskId, NOW_DATE);
    await service.decide(
      verifier,
      qualificationTask.taskId,
      "APPROVED",
      "Qualification source and submitted certificate details were verified.",
      NOW_DATE
    );

    await service.claim(verifier, experienceTask.taskId, NOW_DATE);
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

test("independent identity manual review reaches Verifier and approved outcome verifies Worker identity", async () => {
  const db = await database();
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

    await service.claim(verifier, task.taskId, NOW_DATE);
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
    for (const outcome of ["APPROVED", "REJECTED", "CHANGES_REQUESTED"]) {
      const before = (await db.query("SELECT lock_version,current_version_number FROM worker_identities WHERE worker_account_id=$1", [worker.accountId])).rows[0];
      await corrections.requestOwn(worker, { reason: "Correct the legal spelling against preserved signed identity evidence.", expectedLockVersion: Number(before.lock_version) });
      const pending = (await db.query("SELECT lock_version FROM worker_identities WHERE worker_account_id=$1", [worker.accountId])).rows[0];
      await corrections.submitOwn(worker, Number(pending.lock_version));
      const correctionTask = await service.queueIndependentIdentity(worker, NOW_DATE);
      await service.claim(verifier, correctionTask.taskId, NOW_DATE);
      await service.decide(verifier, correctionTask.taskId, outcome, "Independent correction decision with preserved prior verified identity.", NOW_DATE);
      const after = (await db.query("SELECT lifecycle_status,current_version_number FROM worker_identities WHERE worker_account_id=$1", [worker.accountId])).rows[0];
      assert.equal(after.lifecycle_status, "verified");
      if (outcome !== "APPROVED") assert.equal(after.current_version_number, before.current_version_number);
      const history = await corrections.loadOwn(worker);
      assert.equal(history.decision, outcome === "APPROVED" ? "accepted" : "rejected");
      assert.equal((await db.query("SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1", [worker.accountId])).rows[0].permanent_worker_id, originalId);
      await assert.rejects(service.decide(verifier, correctionTask.taskId, outcome, "Repeated finalized decision must be rejected.", NOW_DATE));
    }

  } finally {
    await db.close();
  }
});


test("approved case review automatically creates and assigns a required interview to an active assessor", async () => {
  const db = await database("0090_interview_worker_availability");
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
    const observationId = oid("supervisor_observation", "S");
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
    await db.query(
      `INSERT INTO supervisor_observations(
         observation_id,tenant_id,case_id,worker_account_id,competency_reference,
         observer_membership_id,observed_at,observation_text,outcome,created_at
       ) VALUES($1,$2,$3,$4,'COMP-INTERVIEW',$5,$6,
                'Supervisor observed the worker completing the competency safely and independently.',
                'demonstrated',$6)`,
      [observationId, tenantId, caseId, worker.accountId, oid("membership", "M"), NOW]
    );
    await db.query(
      `INSERT INTO evidence_review_tasks(
         task_id,tenant_id,case_id,worker_account_id,evidence_kind,
         source_record_id,source_version_id,evidence_label,task_status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,'supervisor_observation',$5,$5,
                'Interview integration observation','QUEUED',$6,$6)`,
      [taskId, tenantId, caseId, worker.accountId, observationId, NOW]
    );

    const service = new EvidenceReviewService(db);
    await service.claim(verifier, taskId, NOW_DATE);
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
    const task=await service.queueIndependentIdentity(worker,NOW_DATE);
    await service.claim(verifier,task.taskId,NOW_DATE);
    await service.decide(verifier,task.taskId,"CHANGES_REQUESTED","The document photograph must be corrected before initial identity verification.",NOW_DATE);
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
    await service.claim(verifier,revisedTask.taskId,NOW_DATE);
    await service.decide(verifier,revisedTask.taskId,"APPROVED","Corrected initial identity evidence was independently verified.",NOW_DATE);
    assert.equal((await repository.loadOwn(worker)).identity.lifecycleStatus,"verified");
    assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM worker_identity_worker_ids WHERE worker_account_id=$1",[worker.accountId])).rows[0].count,1);
    await assert.rejects(repository.reviseOwn(worker,(await repository.loadOwn(worker)).identity.lockVersion));
  } finally { await db.close(); }
});
