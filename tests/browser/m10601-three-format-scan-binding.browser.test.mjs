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

const JPEG = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AI4BAHj/2Q==",
  "base64"
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function pngChunk(name, data) {
  const tag = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([tag, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, tag, data, checksum]);
}
function genuinePng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanline = Buffer.from([0, 80, 140, 220, 255, 45, 90, 180, 255]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat([scanline, scanline]))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
function genuinePdf() {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ compress: false });
    const pieces = [];
    document.on("data", (part) => pieces.push(part));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(pieces)));
    document.text("M1.06.01 synthetic signed-in Worker PDF certificate, exact version binding.");
    document.end();
  });
}
function freePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
async function signInWorker(page, base, email, password) {
  await page.goto(base + "/worker/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/worker/dashboard", { timeout: 20000 });
}

test("M1.06.01 real PDF PNG JPEG Worker uploads scan and bind exact record and version with private previews", { timeout: 220000 }, async () => {
  const fixture = await workerAssessmentSearchFixture();
  fixture.environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT = join(dirname(fixture.environment.HSE_PGLITE_DATA_DIR), "private-files");
  const pdf = await genuinePdf();
  const formats = [
    { filename: "m10601-genuine.pdf", mime: "application/pdf", bytes: pdf },
    { filename: "m10601-genuine.png", mime: "image/png", bytes: genuinePng() },
    { filename: "m10601-genuine.jpeg", mime: "image/jpeg", bytes: JPEG }
  ];
  const base = "http://127.0.0.1:" + (await freePort());
  let recordId;
  try {
    const run = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", new URL(base).port],
      environment: fixture.environment,
      projectRoot: process.cwd(),
      probeUrl: base + "/worker/login",
      probe: async ({ initialResponse, output }) => {
        assert.equal(initialResponse.status, 200, output());
        const browser = await chromium.launch({ headless: true });
        try {
          const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
          const owner = await ownerContext.newPage();
          const errors = [];
          owner.on("pageerror", (error) => errors.push(error.message));
          owner.on("response", (response) => {
            if (response.status() >= 500) errors.push(response.status() + " " + new URL(response.url()).pathname);
          });
          await signInWorker(owner, base, fixture.credentials.worker.email, fixture.credentials.worker.password);
          await owner.goto(base + "/worker/evidence", { waitUntil: "domcontentloaded" });
          const create = owner.locator("section").filter({ has: owner.getByRole("heading", { name: "Create a Worker record", exact: true }) }).first();
          await create.getByRole("button", { name: "Create draft", exact: true }).click();
          await owner.getByText("Qualification draft created.", { exact: true }).waitFor();

          let card = owner.locator("article.panel").filter({ has: owner.getByRole("heading", { name: "Qualification record", exact: true }) }).first();
          recordId = await card.getAttribute("id");
          assert.ok(recordId, "Real Worker evidence record ID missing");

          for (let i = 0; i < formats.length; i++) {
            const file = formats[i];
            await card.getByLabel("Primary certificate file").setInputFiles({
              name: file.filename, mimeType: file.mime, buffer: file.bytes
            });
            await card.getByRole("button", { name: i === 0 ? "Upload file" : "Upload replacement", exact: true }).click();
            try {
              await card.getByText("Certificate uploaded, security-scanned and bound to this qualification version.", { exact: true }).waitFor({ timeout: 30000 });
            } catch (error) {
              console.error("M10601_UPLOAD_DIAGNOSTIC", file.filename, "UI", (await card.innerText()).slice(0, 3500),
                "HTTP", JSON.stringify(errors), "SERVER", output().slice(-1600));
              throw error;
            }
            await owner.reload({ waitUntil: "domcontentloaded" });
            card = owner.locator("article.panel").filter({ has: owner.getByRole("heading", { name: "Qualification record", exact: true }) }).first();
            const history = card.getByRole("region", { name: "qualification history" });
            await history.getByText(new RegExp(file.filename + ".*active")).waitFor();
            if (i > 0) {
              await history.getByText(new RegExp(formats[i - 1].filename + ".*superseded")).waitFor();
            }
            assert.equal(await card.getByRole("region", { name: "qualification pending security scans" }).count(), 0);
          }
          console.log("M10601_THREE_FORMATS_REAL_SCAN_BINDING",
            "actual genuine PDF PNG JPEG accepted via Worker form, each scanner completed before active exact qualification slot");

          const foreignContext = await browser.newContext({ viewport: { width: 320, height: 740 } });
          const foreign = await foreignContext.newPage();
          await signInWorker(foreign, base, "search.foreign@example.test", fixture.credentials.worker.password);

          const history = card.getByRole("region", { name: "qualification history" });
          for (const file of formats) {
            const row = history.locator("p").filter({ hasText: file.filename }).first();
            await row.getByRole("button", { name: "Prepare private preview", exact: true }).click();
            const link = row.getByRole("link", { name: "Open file preview", exact: true });
            await link.waitFor({ timeout: 12000 });
            const href = await link.getAttribute("href");
            assert.match(href, /^\/api\/secure-files\/preview\?access=[A-Za-z0-9_.%~-]+$/);
            const own = await ownerContext.request.get(base + href);
            assert.equal(own.status(), 200, file.filename + " owner preview");
            assert.equal(own.headers()["content-type"], file.mime);
            assert.equal(own.headers()["cache-control"], "private, no-store, max-age=0");
            assert.deepEqual(await own.body(), file.bytes, file.filename + " true immutable preview bytes");
            const copied = await foreignContext.request.get(base + href);
            assert.equal(copied.status(), 404, file.filename + " copied capability must not reveal private Worker evidence");
            const anonymous = await browser.newContext();
            try {
              assert.equal((await anonymous.request.get(base + href)).status(), 404);
            } finally {
              await anonymous.close();
            }
            console.log("M10601_THREE_FORMAT_PRIVATE_PREVIEW", file.filename, file.mime, "owner200 foreign404 anonymous404");
          }
          assert.deepEqual(errors, [], output());
        } finally {
          await browser.close();
        }
      }
    });
    assert.equal(run.requestedSignal, "SMOKE_COMPLETE");

    const db = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      const rows = (await db.query(
        "SELECT a.record_id,a.version_id,a.display_filename,a.superseded_at," +
        "f.owner_account_id,f.lifecycle_status,f.scan_result_code,f.declared_mime,f.detected_mime," +
        "f.content_sha256,f.byte_size,f.available_at " +
        "FROM worker_evidence_attachments a JOIN platform_secure_files f ON f.file_id=a.secure_file_id " +
        "WHERE a.record_id=$1 ORDER BY a.created_at,a.attachment_id", [recordId]
      )).rows;
      assert.equal(rows.length, 3, "All three accepted file versions must remain in one authoritative Worker record");
      const versionId = rows[0].version_id;
      assert.ok(versionId);
      for (let i = 0; i < formats.length; i++) {
        const file = formats[i];
        const row = rows.find((candidate) => candidate.display_filename === file.filename);
        assert.ok(row, "Missing exact stored file " + file.filename);
        assert.equal(row.record_id, recordId);
        assert.equal(row.version_id, versionId);
        assert.equal(row.owner_account_id, fixture.credentials.worker.accountId);
        assert.equal(row.lifecycle_status, "available");
        assert.equal(row.scan_result_code, "clean");
        assert.equal(row.declared_mime, file.mime);
        assert.equal(row.detected_mime, file.mime);
        assert.equal(row.content_sha256, sha(file.bytes));
        assert.equal(Number(row.byte_size), file.bytes.length);
        assert.ok(row.available_at);
        assert.equal(Boolean(row.superseded_at), i < formats.length - 1);
      }
      console.log("M10601_THREE_FORMATS_IMMUTABLE_DB",
        "3 distinct safe scanned content hashes, exact single record/version and owner, PDF PNG JPEG detected MIME, 2 superseded and 1 active");
    } finally {
      await db.close();
    }
  } finally {
    await fixture.cleanup();
  }
});
