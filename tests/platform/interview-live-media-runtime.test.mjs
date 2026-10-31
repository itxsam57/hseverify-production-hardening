import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
const {InterviewMediaAccessError,authorizeInterviewMedia,listInterviewMediaSignals,publishInterviewMediaSignal}=loadTs("src/lib/interview/interview-media-service.ts");

const NOW = "2026-09-25T10:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "interview-live-media-runtime",
  sessionSecret: "interview-live-media-session-secret-2026-000000",
  authPepper: "interview-live-media-auth-pepper-2026-00000000",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function session(accountId, role) {
  return {
    sessionId: `session_${accountId}`,
    accountId,
    role,
    email: `${accountId}@example.test`,
    displayName: accountId,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
}

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0066_interview_live_media");
  return db;
}

async function seedInterview(db) {
  await db.query(
    `INSERT INTO interview_requests(
       interview_request_id,tenant_id,case_id,worker_account_id,status,
       requested_at,scheduled_at,assessor_account_id,timezone
     ) VALUES($1,$2,$3,$4,'ASSIGNED',$5,$6,$7,'Asia/Karachi')`,
    [
      "interview_request_live_media_01",
      "tenant_live_media_01",
      "case_live_media_01",
      "worker_live_media_01",
      NOW,
      "2026-09-25T10:30:00.000Z",
      "assessor_live_media_01"
    ]
  );
}

test("built-in interview media is scoped to the exact Worker and assigned Assessor", async () => {
  const db = await database();
  try {
    await seedInterview(db);
    const worker = session("worker_live_media_01", "worker");
    const assessor = session("assessor_live_media_01", "assessor");
    const outsider = session("worker_live_media_outsider", "worker");

    const workerAccess = await authorizeInterviewMedia(
      db,
      worker,
      "interview_request_live_media_01"
    );
    const assessorAccess = await authorizeInterviewMedia(
      db,
      assessor,
      "interview_request_live_media_01"
    );
    assert.equal(workerAccess.role, "worker");
    assert.equal(assessorAccess.role, "assessor");

    await assert.rejects(
      authorizeInterviewMedia(db, outsider, "interview_request_live_media_01"),
      InterviewMediaAccessError
    );
  } finally {
    await db.close();
  }
});

test("offer, answer and ICE signaling are peer-only and durable", async () => {
  const db = await database();
  try {
    await seedInterview(db);
    const worker = session("worker_live_media_01", "worker");
    const assessor = session("assessor_live_media_01", "assessor");
    const connectionId = "connection_1234567890abcdef";

    await publishInterviewMediaSignal(
      db,
      assessor,
      "interview_request_live_media_01",
      {
        kind: "offer",
        payload: { connectionId, type: "offer", sdp: "v=0\r\nassessor-offer" }
      }
    );

    const workerSignals = await listInterviewMediaSignals(
      db,
      worker,
      "interview_request_live_media_01"
    );
    assert.equal(workerSignals.length, 1);
    assert.equal(workerSignals[0].kind, "offer");

    await publishInterviewMediaSignal(
      db,
      worker,
      "interview_request_live_media_01",
      {
        kind: "answer",
        payload: { connectionId, type: "answer", sdp: "v=0\r\nworker-answer" }
      }
    );
    await publishInterviewMediaSignal(
      db,
      worker,
      "interview_request_live_media_01",
      {
        kind: "ice",
        payload: {
          connectionId,
          candidate: "candidate:1 1 UDP 1 127.0.0.1 5000 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0
        }
      }
    );

    const assessorSignals = await listInterviewMediaSignals(
      db,
      assessor,
      "interview_request_live_media_01"
    );
    assert.deepEqual(
      assessorSignals.map((signal) => signal.kind),
      ["answer", "ice"]
    );

    const stored = await db.query(
      `SELECT actor_role,signal_kind
         FROM interview_media_signals
        WHERE interview_request_id=$1
        ORDER BY created_at,signal_id`,
      ["interview_request_live_media_01"]
    );
    assert.equal(stored.rows.length, 3);
  } finally {
    await db.close();
  }
});

test("interview media rejects malformed signaling instead of trusting browser payloads", async () => {
  const db = await database();
  try {
    await seedInterview(db);
    const assessor = session("assessor_live_media_01", "assessor");

    await assert.rejects(
      publishInterviewMediaSignal(
        db,
        assessor,
        "interview_request_live_media_01",
        {
          kind: "offer",
          payload: { connectionId: "short", type: "offer", sdp: "x" }
        }
      ),
      InterviewMediaAccessError
    );
  } finally {
    await db.close();
  }
});
