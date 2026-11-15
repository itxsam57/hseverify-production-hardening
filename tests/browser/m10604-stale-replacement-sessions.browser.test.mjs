import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function chunk(kind, bytes) {
  const tag = Buffer.from(kind), length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  let crc = 0xffffffff;
  for (const b of Buffer.concat([tag, bytes])) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, tag, bytes, checksum]);
}
function png(pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, ...pixel]))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
const V1 = png([30, 75, 100, 255]);
const V2 = png([180, 90, 20, 255]);
const V3 = png([45, 195, 210, 255]);
const V4 = png([125, 50, 220, 255]);
assert.equal(new Set([sha(V1),sha(V2),sha(V3),sha(V4)]).size, 4);

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}
const findRecord = page => page.locator("article.panel").filter({
  has: page.getByRole("heading", { name: "Qualification record", exact: true })
}).first();
async function login(page, base, credentials) {
  await page.goto(base + "/worker/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/worker/dashboard", { timeout: 18000 });
  await page.goto(base + "/worker/evidence", { waitUntil: "domcontentloaded" });
}
async function upload(page, name, bytes, replacement = true) {
  const record = findRecord(page);
  await record.getByLabel("Primary certificate file").setInputFiles({
    name, mimeType: "image/png", buffer: bytes
  });
  const post = page.waitForResponse(response => response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/worker/evidence", { timeout: 26000 });
  await record.getByRole("button", { name: replacement ? "Upload replacement" : "Upload file", exact: true }).click();
  assert.equal((await post).status(), 200);
}
async function preview(page, context, base, name, bytes) {
  const record = findRecord(page);
  const history = record.getByRole("region", { name: "qualification history" });
  const row = history.locator("p").filter({ hasText: name }).first();
  await row.getByRole("button", { name: "Prepare private preview", exact: true }).click();
  const link = row.getByRole("link", { name: "Open file preview", exact: true });
  await link.waitFor({ timeout: 14000 });
  const url = await link.getAttribute("href");
  assert.match(url, /^\/api\/secure-files\/preview\?access=[A-Za-z0-9_.%~-]+$/);
  const response = await context.request.get(base + url);
  assert.equal(response.status(), 200);
  assert.equal(response.headers()["cache-control"], "private, no-store, max-age=0");
  assert.equal(response.headers()["content-type"], "image/png");
  assert.deepEqual(await response.body(), bytes, name + " signed preview must be byte exact");
}

test("M1.06.04 independent Worker sessions reject stale attachment replacement and preserve private previews", { timeout: 240000 }, async () => {
  const fixture = await workerAssessmentSearchFixture();
  fixture.environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT = join(dirname(fixture.environment.HSE_PGLITE_DATA_DIR), "private-files");
  const base = "http://127.0.0.1:" + await freePort();
  let recordId, versionId, actorId;
  try {
    const run = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", new URL(base).port],
      projectRoot: process.cwd(), environment: fixture.environment,
      probeUrl: base + "/worker/login",
      probe: async ({ initialResponse, output }) => {
        assert.equal(initialResponse.status, 200, output());
        const browser = await chromium.launch({ headless: true });
        try {
          const a = await browser.newContext({ viewport: { width: 390, height: 844 } });
          const b = await browser.newContext({ viewport: { width: 1280, height: 840 } });
          const pageA = await a.newPage();
          const pageB = await b.newPage();
          const errors = [];
          for (const page of [pageA, pageB]) {
            page.on("pageerror", error => errors.push(error.message));
            page.on("response", response => {
              if (response.status() >= 500) errors.push(response.status() + " " + new URL(response.url()).pathname);
            });
          }
          await login(pageA, base, fixture.credentials.worker);
          const create = pageA.locator("section").filter({
            has: pageA.getByRole("heading", { name: "Create a Worker record", exact: true })
          }).first();
          await create.getByRole("button", { name: "Create draft", exact: true }).click();
          await pageA.getByText("Qualification draft created.", { exact: true }).waitFor();
          recordId = await findRecord(pageA).getAttribute("id");
          versionId = await findRecord(pageA).locator('input[name="versionId"]').first().inputValue();
          actorId = fixture.credentials.worker.accountId;
          assert.ok(recordId && versionId && actorId);
          await upload(pageA, "m10604-initial-safe.png", V1, false);
          await pageA.reload({ waitUntil: "domcontentloaded" });
          await findRecord(pageA).getByRole("region", { name: "qualification history" }).getByText(/m10604-initial-safe.png.*active/).waitFor();

          // Independent browser context B gets a bona fide previously valid form snapshot.
          await login(pageB, base, fixture.credentials.worker);
          const initialExpectedA = await findRecord(pageA).locator('input[name="expectedActiveAttachmentId"]').first().inputValue();
          const staleExpectedB = await findRecord(pageB).locator('input[name="expectedActiveAttachmentId"]').first().inputValue();
          assert.ok(initialExpectedA && initialExpectedA === staleExpectedB);
          assert.equal(await findRecord(pageB).locator('input[name="versionId"]').first().inputValue(), versionId);

          // Another authenticated session replaces V1 with V2 while B does not refresh.
          await upload(pageA, "m10604-winner.png", V2);
          await pageA.reload({ waitUntil: "domcontentloaded" });
          await findRecord(pageA).getByRole("region", { name: "qualification history" }).getByText(/m10604-winner.png.*active/).waitFor();
          assert.equal(await findRecord(pageB).locator('input[name="expectedActiveAttachmentId"]').first().inputValue(), staleExpectedB,
            "Second real browser session must still hold its old attachment snapshot before the stale submission");

          // The stale form still submits a genuine signed-in Worker Server Action.
          await upload(pageB, "m10604-stale-loser.png", V3);
          await findRecord(pageB).getByText(
            "This evidence record changed in another request. The latest state has been preserved; reload and review it before trying again.",
            { exact: true }
          ).waitFor({ timeout: 18000 });
          console.log("M10604_STALE_TWO_SESSIONS_REPLACEMENT_CONFLICT_BROWSER",
            "two independent signed Worker contexts; stale snapshot upload denied, old winner not silently overwritten");
          await pageB.reload({ waitUntil: "domcontentloaded" });
          const history = findRecord(pageB).getByRole("region", { name: "qualification history" });
          await history.getByText(/m10604-initial-safe.png.*superseded/).waitFor();
          await history.getByText(/m10604-winner.png.*active/).waitFor();
          assert.equal(await history.getByText(/m10604-stale-loser.png/).count(), 0);
          await preview(pageB, b, base, "m10604-winner.png", V2);
          await preview(pageB, b, base, "m10604-initial-safe.png", V1);
          console.log("M10604_STALE_CONFLICT_PRIVATE_PREVIEW_BROWSER",
            "after conflict winner and old superseded exact signed previews 200, no stale loser evidence preview");

          // A genuine client retry must first refresh its expected-active binding
          // and then atomically supersede only the winner. This distinguishes
          // stale rejection from an unusable workflow.
          const freshExpectedB = await findRecord(pageB).locator('input[name="expectedActiveAttachmentId"]').first().inputValue();
          assert.ok(freshExpectedB && freshExpectedB !== staleExpectedB);
          await upload(pageB, "m10604-recovered.png", V4);
          await pageB.reload({ waitUntil: "domcontentloaded" });
          await history.getByText(/m10604-winner.png.*superseded/).waitFor();
          await history.getByText(/m10604-recovered.png.*active/).waitFor();
          assert.equal(await history.getByText(/m10604-stale-loser.png/).count(), 0);
          await preview(pageB, b, base, "m10604-recovered.png", V4);
          assert.equal(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.equal(await pageB.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.deepEqual(errors, [], output());
          console.log("M10604_STALE_RECOVERY_RELOAD_BROWSER",
            "refresh B accepted updated version binding, replacement successful, loser excluded, 390px+desktop no overflow/errors");
          await a.close(); await b.close();
        } finally {
          await browser.close();
        }
      }
    });
    assert.equal(run.requestedSignal, "SMOKE_COMPLETE");
    const db = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      const bound = (await db.query(
        "SELECT a.record_id,a.version_id,a.display_filename,a.secure_file_id,a.superseded_at," +
        " f.lifecycle_status,f.scan_result_code,f.content_sha256,f.owner_account_id" +
        " FROM worker_evidence_attachments a JOIN platform_secure_files f ON f.file_id=a.secure_file_id" +
        " WHERE a.record_id=$1 ORDER BY a.created_at,a.attachment_id", [recordId]
      )).rows;
      assert.equal(bound.length, 3, "Only original, winner and refreshed retry can be accepted");
      for (const row of bound) {
        assert.equal(row.record_id, recordId);
        assert.equal(row.version_id, versionId);
        assert.equal(row.owner_account_id, actorId);
        assert.equal(row.lifecycle_status, "available");
        assert.equal(row.scan_result_code, "clean");
      }
      const fileByName = name => bound.find(row => row.display_filename === name);
      const first = fileByName("m10604-initial-safe.png");
      const winner = fileByName("m10604-winner.png");
      const last = fileByName("m10604-recovered.png");
      assert.ok(first && winner && last);
      assert.ok(first.superseded_at && winner.superseded_at && last.superseded_at === null);
      assert.equal(first.content_sha256, sha(V1));
      assert.equal(winner.content_sha256, sha(V2));
      assert.equal(last.content_sha256, sha(V4));
      const loserFile = (await db.query(
        "SELECT file_id,lifecycle_status,content_sha256,owner_account_id FROM platform_secure_files" +
        " WHERE display_filename='m10604-stale-loser.png' AND owner_account_id=$1", [actorId]
      )).rows;
      assert.equal(loserFile.length, 1);
      assert.equal(loserFile[0].owner_account_id, actorId);
      assert.equal(loserFile[0].content_sha256, sha(V3));
      assert.equal(loserFile[0].lifecycle_status, "available", "Scan success alone must not constitute a binding");
      assert.equal(bound.some(row => row.secure_file_id === loserFile[0].file_id), false);
      const failedCandidate = (await db.query(
        "SELECT candidate_status,secure_file_id,expected_active_binding_id,record_id,version_id" +
        " FROM worker_evidence_file_candidates WHERE secure_file_id=$1", [loserFile[0].file_id]
      )).rows;
      assert.equal(failedCandidate.length, 1);
      assert.equal(failedCandidate[0].candidate_status, "pending");
      assert.equal(failedCandidate[0].expected_active_binding_id, first && (await db.query(
        "SELECT attachment_id FROM worker_evidence_attachments WHERE secure_file_id=$1",
        [first.secure_file_id]
      )).rows[0].attachment_id);
      assert.equal(failedCandidate[0].record_id, recordId);
      assert.equal(failedCandidate[0].version_id, versionId);
      const audits = (await db.query(
        "SELECT action_key FROM platform_audit_events WHERE target_reference=$1" +
        " AND action_key IN ('worker_evidence.file.attached','worker_evidence.file.replaced')",
        [recordId]
      )).rows;
      assert.equal(audits.filter(row => row.action_key === "worker_evidence.file.attached").length, 1);
      assert.equal(audits.filter(row => row.action_key === "worker_evidence.file.replaced").length, 2,
        "Conflict must not falsely produce third successful replacement audit");
      console.log("M10604_STALE_ATTACHED_DB_AUDIT",
        "three accepted exact-version immutable files, one scanned-but-unbound loser, one attach plus two replace audits");
    } finally { await db.close(); }
  } finally { await fixture.cleanup(); }
});
