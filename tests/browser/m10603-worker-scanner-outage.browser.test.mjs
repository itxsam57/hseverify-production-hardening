import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import PDFDocument from "pdfkit";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function pngChunk(name, data) {
  const tag = Buffer.from(name, "ascii"), len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([tag, data])) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const digest = Buffer.alloc(4);
  digest.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, tag, data, digest]);
}
function genuinePng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 45, 100, 190, 255]))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
async function genuineRetryOncePdf() {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ compress: false }), parts = [];
    document.on("data", (part) => parts.push(part));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(parts)));
    document.addContent("% HSE_VERIFY_SCAN_RETRY_ONCE");
    document.text("M1.06.03 synthetic local scanner retry-once certificate");
    document.end();
  });
}
function freePort() {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
test("M1.06.03 actual Worker scanner retry retains safe file until same-object successful scan", { timeout: 230000 }, async () => {
  const fixture = await workerAssessmentSearchFixture();
  fixture.environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT = join(dirname(fixture.environment.HSE_PGLITE_DATA_DIR), "private-files");
  const before = genuinePng(), replacement = await genuineRetryOncePdf();
  assert.ok(replacement.toString("latin1").includes("HSE_VERIFY_SCAN_RETRY_ONCE"));
  const base = "http://127.0.0.1:" + (await freePort());
  let recordId, versionId;
  try {
    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", new URL(base).port],
      projectRoot: process.cwd(), environment: fixture.environment,
      probeUrl: base + "/worker/login",
      probe: async ({ initialResponse, output }) => {
        assert.equal(initialResponse.status, 200, output());
        const browser = await chromium.launch({ headless: true });
        try {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
          const page = await context.newPage(), errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("response", (response) => {
            if (response.status() >= 500) errors.push(response.status() + " " + new URL(response.url()).pathname);
          });
          await page.goto(base + "/worker/login", { waitUntil: "domcontentloaded" });
          await page.getByLabel("Email address").fill(fixture.credentials.worker.email);
          await page.getByLabel("Password").fill(fixture.credentials.worker.password);
          await page.getByRole("button", { name: "Sign in", exact: true }).click();
          await page.waitForURL("**/worker/dashboard", { timeout: 20000 });
          await page.goto(base + "/worker/evidence", { waitUntil: "domcontentloaded" });
          const creation = page.locator("section").filter({
            has: page.getByRole("heading", { name: "Create a Worker record", exact: true })
          }).first();
          await creation.getByRole("button", { name: "Create draft", exact: true }).click();
          await page.getByText("Qualification draft created.", { exact: true }).waitFor();
          const card = page.locator("article.panel").filter({
            has: page.getByRole("heading", { name: "Qualification record", exact: true })
          }).first();
          recordId = await card.getAttribute("id");
          versionId = await card.locator('input[name="versionId"]').first().inputValue();
          assert.ok(recordId && versionId);
          const picker = card.getByLabel("Primary certificate file");
          await picker.setInputFiles({ name: "m10603-safe-original.png", mimeType: "image/png", buffer: before });
          await card.getByRole("button", { name: "Upload file", exact: true }).click();
          await card.getByText("Certificate uploaded, security-scanned and bound to this qualification version.", { exact: true }).waitFor({ timeout: 25000 });
          await page.reload({ waitUntil: "domcontentloaded" });
          const history = card.getByRole("region", { name: "qualification history" });
          await history.getByText(/m10603-safe-original.png.*active/).waitFor();

          // A valid PDF retryable on its FIRST lease must be quarantined,
          // not silently replace the already accepted PNG.
          await picker.setInputFiles({ name: "m10603-retry-pending.pdf", mimeType: "application/pdf", buffer: replacement });
          const pendingPost = page.waitForResponse((response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/worker/evidence", { timeout: 30000 });
          await card.getByRole("button", { name: "Upload replacement", exact: true }).click();
          assert.equal((await pendingPost).status(), 200);
          await card.getByText("File uploaded and queued for security scanning. It is not attached yet; use Check scan status after the scan completes.", { exact: true }).waitFor({ timeout: 30000 });
          await page.reload({ waitUntil: "domcontentloaded" });
          const pending = card.getByRole("region", { name: "qualification pending security scans" });
          await pending.waitFor();
          await pending.getByText(/m10603-retry-pending.pdf.*scan pending/).waitFor();
          await history.getByText(/m10603-safe-original.png.*active/).waitFor();
          assert.equal(await history.getByText(/m10603-retry-pending.pdf/).count(), 0);
          const old = history.locator("p").filter({ hasText: "m10603-safe-original.png" }).first();
          await old.getByRole("button", { name: "Prepare private preview", exact: true }).click();
          const oldPreview = old.getByRole("link", { name: "Open file preview", exact: true });
          await oldPreview.waitFor();
          const oldHref = await oldPreview.getAttribute("href");
          assert.match(oldHref, /^\/api\/secure-files\/preview\?access=/);
          const oldResponse = await context.request.get(base + oldHref);
          assert.equal(oldResponse.status(), 200, "Already accepted file must remain privately viewable during scanner outage");
          assert.deepEqual(await oldResponse.body(), before);
          console.log("M10603_PENDING_BROWSER_OLD_SAFE_RETAINED",
            "Worker active safe PNG still signed-previewable; retry-once PDF stays scan_pending with no accepted attachment");

          // The outbox domain explicitly waits five seconds before retry #2.
          // Use its actual schedule, not an in-test DB rewrite or fake scanner.
          await new Promise((resolve) => setTimeout(resolve, 6500));
          const retryPost = page.waitForResponse((response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/worker/evidence", { timeout: 30000 });
          await pending.getByRole("button", { name: "Check scan status", exact: true }).click();
          assert.equal((await retryPost).status(), 200);
          // Revalidation can unmount the transient success feedback. Only
          // durable server-rendered attachment state proves recovery.
          await history.getByText(/m10603-safe-original.png.*superseded/).waitFor({ timeout: 20000 });
          await history.getByText(/m10603-retry-pending.pdf.*active/).waitFor({ timeout: 20000 });
          await page.reload({ waitUntil: "domcontentloaded" });
          await history.getByText(/m10603-safe-original.png.*superseded/).waitFor();
          await history.getByText(/m10603-retry-pending.pdf.*active/).waitFor();
          assert.equal(await card.getByRole("region", { name: "qualification pending security scans" }).count(), 0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.deepEqual(errors, [], output());
          console.log("M10603_RECOVERED_BROWSER",
            "Worker retried same PDF job, recovered clean, original PNG retained superseded, new PDF only active, responsive390");
        } finally {
          await browser.close();
        }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
    const db = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      const rows = (await db.query(
        "SELECT a.record_id,a.version_id,a.display_filename,a.superseded_at,a.secure_file_id," +
        " f.lifecycle_status,f.scan_result_code,f.content_sha256,f.scan_job_id,f.scan_generation," +
        " f.available_at FROM worker_evidence_attachments a JOIN platform_secure_files f ON f.file_id=a.secure_file_id" +
        " WHERE a.record_id=$1 ORDER BY a.created_at,a.attachment_id", [recordId]
      )).rows;
      assert.equal(rows.length, 2);
      const original = rows.find((row) => row.display_filename === "m10603-safe-original.png");
      const recovered = rows.find((row) => row.display_filename === "m10603-retry-pending.pdf");
      assert.ok(original && recovered);
      for (const row of rows) {
        assert.equal(row.record_id, recordId);
        assert.equal(row.version_id, versionId);
        assert.equal(row.lifecycle_status, "available");
        assert.equal(row.scan_result_code, "clean");
        assert.ok(row.available_at);
      }
      assert.equal(original.content_sha256, sha(before));
      assert.ok(original.superseded_at);
      assert.equal(recovered.content_sha256, sha(replacement));
      assert.equal(recovered.superseded_at, null);
      assert.equal(Number(recovered.scan_generation), 1);
      const jobs = (await db.query(
        "SELECT job_id,job_type,status,attempt_count FROM platform_outbox_jobs WHERE job_id=$1",
        [recovered.scan_job_id]
      )).rows;
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].job_type, "secure_file.scan");
      assert.equal(jobs[0].status, "succeeded");
      assert.equal(Number(jobs[0].attempt_count), 2,
        "The same original immutable scan job must retry, not create a replacement job");
      const attempts = (await db.query(
        "SELECT attempt_number,outcome FROM platform_outbox_job_attempts WHERE job_id=$1 ORDER BY attempt_number",
        [recovered.scan_job_id]
      )).rows;
      assert.deepEqual(attempts.map((x) => x.outcome), ["retry_scheduled", "succeeded"]);
      const audited = (await db.query(
        "SELECT action_key,target_reference FROM platform_audit_events" +
        " WHERE action_key='secure_file.scan.available' AND target_reference=$1",
        [recovered.secure_file_id]
      )).rows;
      assert.equal(audited.length, 1);
      console.log("M10603_OUTAGE_DB_IMMUTABLE",
        "one original retry job with two attempts, same file SHA256, exact version/record, prior safe retained, one clean availability audit");
    } finally {
      await db.close();
    }
  } finally {
    await fixture.cleanup();
  }
});
