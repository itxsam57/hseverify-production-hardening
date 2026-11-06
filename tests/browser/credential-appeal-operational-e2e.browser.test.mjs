import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { verifyAppealConsumerJourney } from "../helpers/appeal-consumer-browser-journey.mjs";

import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { seedCredentialDecisionFixture } from "../helpers/credential-decision-fixture.mjs";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("No free port."));
        else resolve(address.port);
      });
    });
  });
}


test(
  "Worker submits credential appeal, Admin independently reviews it, and accepted reassessment supersedes Living Record state",
  { timeout: 240_000 },
  async () => {
    const root = process.cwd();
    const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-credential-appeal-browser-"));
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const environment = {
      ...process.env,
      HSE_APP_ENV: "development",
      HSE_DATABASE_DRIVER: "pglite",
      HSE_PGLITE_DATA_DIR: databaseDirectory,
      HSE_AUDIT_CREDENTIALS_PATH: join(databaseDirectory,"browser-credentials.json"),
      HSE_CREDENTIAL_SIGNING_SECRET: randomBytes(32).toString("hex"),
      HSE_RELEASE_SHA: "credential-appeal-operational-browser",
      HSE_SESSION_SECRET: "credential-appeal-browser-session-secret-2026-000000000",
      HSE_AUTH_PEPPER: "credential-appeal-browser-auth-pepper-2026-00000000000",
      HSE_ENABLE_AUTH_SANDBOX: "false",
      HSE_ENABLE_WORKER_DEMO_AUTH: "false",
      HSE_USE_WORKER_DEMO_DATA: "false"
    };

    try {
      const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
        cwd: root,
        env: environment,
        encoding: "utf8"
      });
      assert.equal(migration.status, 0, migration.stderr || migration.stdout);

      const seed = spawnSync(process.execPath, ["scripts/independent-audit-seed.mjs"], {
        cwd: root,
        env: environment,
        encoding: "utf8"
      });
      assert.equal(seed.status, 0, seed.stderr || seed.stdout);
      const credentials = JSON.parse(
        await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH, "utf8")
      );

      const workerId = "HSE-REG-INDEPENDENTAUDIT";
      let credentialId;
      const evidenceRecordId = "worker_evidence_record_appeal_browser_01";
      const evidenceVersionId = "worker_evidence_version_appeal_browser_01";
      let competencyId;
      const issuedAt = "2026-09-20T10:00:00.000Z";

      // Real decision producer creates signed issuance, case provenance and Living Record.
      const fixtureDatabase=await openScriptDatabase({appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:databaseDirectory,releaseSha:environment.HSE_RELEASE_SHA});
      const originalFixture=await seedCredentialDecisionFixture(fixtureDatabase,{
        qualification:"HSE Operational Assurance",policy:{credentialValidity:"no_expiry"},
        workerAccountId:credentials.worker.accountId,permanentWorkerId:workerId,
        signingSecret:environment.HSE_CREDENTIAL_SIGNING_SECRET,tenantId:credentials.company.tenantId
      });
      try {
        const originalActor="account_original_appeal_browser_admin";
        await originalFixture.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'original-appeal-browser@example.test','Original decision admin','active','test-only',$2,$2,$2,$2)",[originalActor,issuedAt]);
        await originalFixture.database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[originalActor,issuedAt]);
        await originalFixture.repo.saveDecisionAndProgressCase(originalFixture.decision,originalActor);
        credentialId=(await originalFixture.database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[originalFixture.caseId])).rows[0].credential_reference;
        competencyId=(await originalFixture.database.query("SELECT competency_id FROM living_record_competencies WHERE source_credential_id=$1",[credentialId])).rows[0].competency_id;
        assert.notEqual(originalActor,credentials.admin.accountId);
        const invitationId="worker_invitation_"+"q".repeat(24),linkId="company_worker_link_"+"q".repeat(24);
        await originalFixture.database.query(`INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,payment_responsibility,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at)
          VALUES($1,$2,$3,'synthetic-appeal-link','accepted','company',$4,$5,$6,'2099-01-01',$6,$6,$6)`,[invitationId,credentials.company.tenantId,credentials.worker.email,credentials.company.membershipId,credentials.worker.accountId,issuedAt]);
        await originalFixture.database.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
          VALUES($1,$2,$3,'invitation',$4,'active','company',$5,$6,$6,$6,$6)`,[linkId,credentials.company.tenantId,credentials.worker.accountId,invitationId,credentials.company.membershipId,issuedAt]);

      } finally { await originalFixture.database.close(); }
      const database = new PGlite(databaseDirectory);
      try {

        await database.query(
          `INSERT INTO worker_evidence_records(
             record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at
           ) VALUES($1,$2,'qualification','active',NULL,$3,$3)`,
          [evidenceRecordId, credentials.worker.accountId, issuedAt]
        );
        await database.query(
          `INSERT INTO worker_evidence_versions(
             version_id,record_id,version_number,revision,version_status,supersedes_version_id,
             created_at,updated_at,submitted_at
           ) VALUES($1,$2,1,1,'submitted',NULL,$3,$3,$3)`,
          [evidenceVersionId, evidenceRecordId, issuedAt]
        );
        await database.query(
          `INSERT INTO worker_qualification_versions(
             version_id,qualification_title,category,issuing_organization,certificate_number,
             issue_date,qualification_level,country,declaration_accepted
           ) VALUES($1,'HSE Operational Assurance','Occupational Safety','HSE Institute',
             'APPEAL-BROWSER-001','2026-01-15','Level 3','Pakistan',true)`,
          [evidenceVersionId]
        );
        await database.query(
          "UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1",
          [evidenceRecordId, evidenceVersionId]
        );
      } finally {
        await database.close();
      }

      const result = await runDevelopmentServer({
        args: ["--hostname", "127.0.0.1", "--port", String(port)],
        probeUrl: `${baseUrl}/worker/login`,
        projectRoot: root,
        environment,
        probe: ({output}) => verifyAppealConsumerJourney({baseUrl,credentials,credentialId,evidenceRecordId,output})
      });
      assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

      const verification = new PGlite(databaseDirectory);
      try {
        const appeal = await verification.query(
          `SELECT status,version,reviewer_account_id,review_reason,outcome_action
             FROM credential_appeals WHERE credential_id=$1`,
          [credentialId]
        );
        assert.equal(appeal.rows[0]?.status, "accepted");
        assert.equal(appeal.rows[0]?.version, 3);
        assert.equal(appeal.rows[0]?.reviewer_account_id, credentials.admin.accountId);
        assert.equal(appeal.rows[0]?.outcome_action, "reassessment");
        assert.match(appeal.rows[0]?.review_reason ?? "", /requires reassessment/i);

        const events = await verification.query(
          `SELECT status,version FROM credential_appeal_events
            WHERE appeal_id IN (SELECT appeal_id FROM credential_appeals WHERE credential_id=$1)
            ORDER BY version`,
          [credentialId]
        );
        assert.deepEqual(events.rows.map((row) => row.status), ["submitted", "under_review", "accepted"]);

        const living = await verification.query(
          `SELECT version,status,reassessment
             FROM living_record_versions
            WHERE competency_id=$1 ORDER BY version`,
          [competencyId]
        );
        assert.deepEqual(living.rows.map((row) => row.status), ["valid", "reassessment_required"]);
        assert.equal(living.rows[1]?.version, 2);
      } finally {
        await verification.close();
      }
    } finally {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  }
);