import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

test("M3.03 share-link API boundary is reachable through real Chromium", async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-m303-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "m3-03-browser-local",
    HSE_SESSION_SECRET: "m3-03-browser-session-secret-2026-000000000000"
  };

  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: projectRoot,
      env: environment,
      encoding: "utf8"
    });
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);

    // Seed the real persisted recipient links, with signed tokens matching
    // the production service's secret derivation. The recipient browser
    // remains anonymous; no privileged mock route is used.
    const workerRef = "HSE-WRK-303-SHARED";
    const accountId = "m303_test_worker";
    const signingKey = createHash("sha256")
      .update("hseverify:scoped-share-links\0", "utf8")
      .update(environment.HSE_SESSION_SECRET, "utf8")
      .digest("hex");
    const { ScopedShareLinkManager } = loadTs("src/lib/share-links/scoped-share-link-domain.ts");
    const manager = new ScopedShareLinkManager(signingKey);
    const now = Date.now();
    const createdAt = new Date(now - 3 * 86_400_000).toISOString();
    const soon = new Date(now + 2 * 86_400_000).toISOString();
    const expired = new Date(now - 1 * 86_400_000).toISOString();
    const privateEmployer = "PRIVATE EMPLOYER SHOULD NEVER APPEAR";
    const common = {ownerWorkerId:workerRef,createdAt,employerDetail:privateEmployer};
    const workerOnly = manager.create({...common,fields:["worker_id"],purpose:"Owner selected Worker ID only",expiresAt:soon});
    const employerOnly = manager.create({...common,fields:["employer_detail"],purpose:"Owner selected employer only",expiresAt:soon});
    const past = manager.create({...common,fields:["worker_id"],purpose:"Expired private purpose",expiresAt:expired});
    const revoked = manager.create({...common,fields:["worker_id"],purpose:"Revoked private purpose",expiresAt:soon});
    const db = await PGlite.create(databaseDirectory);
    try {
      await db.query(
        "INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,worker_reference,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'m303@example.test','M303 Worker','active','test_fixture_hash',$2,$3,$3,$3,$3)",
        [accountId,workerRef,createdAt]);
      for (const issued of [workerOnly,employerOnly,past,revoked]){
        const record=issued.record;
        await db.query(
          "INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,employer_detail,created_at,expires_at,revoked_at,token_nonce_hash) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)",
          [record.shareLinkId,record.ownerWorkerId,JSON.stringify(record.fields),record.purpose,record.employerDetail,record.createdAt,record.expiresAt,issued===revoked?new Date(now-50_000).toISOString():null,record.tokenNonceHash]
        );
      }
    }finally{await db.close();}

    await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/api/share-links?ownerWorkerId=HSE-WRK-000321`,
      projectRoot,
      environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          const response = await page.goto(
            `${baseUrl}/share/invalid-token?shareLinkId=share_link_missing`,
            { waitUntil: "networkidle" }
          );
          assert(response);
          assert.equal(response.status(), 200);
          await page.getByRole("heading", { name: "Share link unavailable" }).waitFor();
          const heading = await page
            .getByRole("heading", { name: "Share link unavailable" })
            .textContent();
          assert.equal(heading, "Share link unavailable");
          const body = await page.locator("main").textContent();
          assert.equal((body ?? "").trim(), "Share link unavailable",
            "A public recipient must never learn whether the share link is invalid, expired, revoked, or worker-mismatched.");
          const api = await page.request.get(
            `${baseUrl}/api/share-links/public?shareLinkId=share_link_missing&token=invalid-token`
          );
          assert.equal(api.status(),403);
          assert.deepEqual(await api.json(),{error:"share_link_unavailable"});
          console.log("ACTUAL_M303_DENIAL_BROWSER public HTML and JSON must render identical neutral denial with no internal reason.");

          for (const [label, issued] of [
            ["expired",past],
            ["revoked",revoked]
          ]) {
            const denied = await page.goto(baseUrl+issued.shareUrl,{waitUntil:"domcontentloaded"});
            assert.equal(denied?.status(),200);
            assert.equal((await page.locator("main").innerText()).trim(),"Share link unavailable",label+" leaked internal reason");
            const deniedApi=await page.request.get(
              `${baseUrl}/api/share-links/public?shareLinkId=${issued.record.shareLinkId}&token=${encodeURIComponent(issued.token)}`
            );
            assert.equal(deniedApi.status(),403);
            assert.deepEqual(await deniedApi.json(),{error:"share_link_unavailable"});
            console.log("ACTUAL_M303_DENIAL_BROWSER "+label+" recipient denied neutrally via page and API");
          }
          const forged=workerOnly.token.slice(0,-1)+(workerOnly.token.endsWith("A")?"B":"A");
          await page.goto(baseUrl+`/share/${forged}?shareLinkId=${workerOnly.record.shareLinkId}`,{waitUntil:"domcontentloaded"});
          assert.equal((await page.locator("main").innerText()).trim(),"Share link unavailable");
          console.log("ACTUAL_M303_DENIAL_BROWSER altered HMAC cannot distinguish existing active share record");

          await page.goto(baseUrl+workerOnly.shareUrl,{waitUntil:"domcontentloaded"});
          const workerText=await page.locator("main").innerText();
          assert.match(workerText,/Shared digital passport/);
          assert.match(workerText,/Owner selected Worker ID only/);
          assert.match(workerText,/HSE-WRK-303-SHARED/);
          assert.doesNotMatch(workerText,/PRIVATE EMPLOYER|Recipient or employer:|Expired private purpose|Revoked private purpose/);
          await page.goto(baseUrl+employerOnly.shareUrl,{waitUntil:"domcontentloaded"});
          const employerText=await page.locator("main").innerText();
          assert.match(employerText,/Owner selected employer only/);
          assert.match(employerText,/PRIVATE EMPLOYER SHOULD NEVER APPEAR/);
          assert.doesNotMatch(employerText,/Worker ID:|HSE-WRK-303-SHARED|Owner selected Worker ID only/);
          console.log("ACTUAL_M303_SCOPED_PUBLIC_BROWSER owner-approved Worker ID vs employer detail scopes do not leak each other's unselected data");

        } finally {
          await browser.close();
        }
      }
    });

    const persisted = await PGlite.create(databaseDirectory);
    try {
      const records=(await persisted.query(
        "SELECT share_link_id,purpose,fields,expires_at,revoked_at FROM scoped_share_links WHERE owner_worker_id=$1 ORDER BY share_link_id",[workerRef]
      )).rows;
      assert.equal(records.length,4);
      const workerRecord=records.find(record=>record.share_link_id===workerOnly.record.shareLinkId);
      const employerRecord=records.find(record=>record.share_link_id===employerOnly.record.shareLinkId);
      assert.deepEqual(workerRecord.fields,["worker_id"]);
      assert.deepEqual(employerRecord.fields,["employer_detail"]);
      assert.equal(workerRecord.purpose,"Owner selected Worker ID only");
      assert.equal(new Date(workerRecord.expires_at).toISOString(),soon);
      const logs=(await persisted.query(
        "SELECT share_link_id,outcome,reason FROM scoped_share_access_logs WHERE share_link_id=ANY($1::text[])",[
          [workerOnly.record.shareLinkId,employerOnly.record.shareLinkId,past.record.shareLinkId,revoked.record.shareLinkId]
        ]
      )).rows;
      for(const [id,outcome,reason] of [
        [workerOnly.record.shareLinkId,"granted","active"],
        [employerOnly.record.shareLinkId,"granted","active"],
        [past.record.shareLinkId,"denied","expired"],
        [revoked.record.shareLinkId,"denied","revoked"]
      ]) assert.ok(logs.some(log=>log.share_link_id===id&&log.outcome===outcome&&log.reason===reason),
        "Recipient access reason kept privately in server audit log, not shown to public browser: "+reason);
      console.log("ACTUAL_M303_AUDIT_DB selected fields/purpose/expiry persisted; allowed, expired and revoked recipient accesses audited privately");
    }finally{await persisted.close();}
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
