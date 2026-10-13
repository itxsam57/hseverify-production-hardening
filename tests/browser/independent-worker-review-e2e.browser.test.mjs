import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const PNG_FILE = {
  name: "proof.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
};
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) bits += B32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

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

async function login(page, baseUrl, credential, role) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000 });
}

async function uploadIdentityEvidence(page, heading, fileName, document = false) {
  const card = page.getByRole("region", { name: heading, exact: true });
  if (document) {
    await card.getByLabel("Document type").selectOption("passport");
    await card.getByLabel("Document number").fill("PK-INDEPENDENT-VERIFY-001");
    await card.getByLabel("Issue date").fill("2025-01-01");
    await card.getByLabel("Expiry date").fill("2035-01-01");
  }
  await card.getByLabel(/^(Choose|Replace) file/).setInputFiles({ ...PNG_FILE, name: fileName });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/identity")),
    card.getByRole("button", { name: /^(Upload|Replace) evidence$/ }).click()
  ]);
}

async function createEvidence(page, baseUrl, kind, fields) {
  await page.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Record type").selectOption(kind);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    page.getByRole("button", { name: "Create draft" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  const title = `${kind[0].toUpperCase()}${kind.slice(1)} record`;
  const article = page.locator("article").filter({ hasText: title }).first();

  for (const [label, value] of fields.inputs ?? []) {
    const control = label === "Skill"
      ? article.getByRole("textbox", { name: "Skill", exact: true })
      : article.getByLabel(label, { exact: false }).first();
    await control.fill(String(value));
  }
  for (const [label, value] of fields.selects ?? []) {
    await article.getByLabel(label, { exact: false }).first().selectOption(String(value));
  }
  for (const label of fields.checks ?? []) {
    await article.getByLabel(label).check();
  }
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    article.getByRole("button", { name: "Save metadata" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  const updated = page.locator("article").filter({ hasText: title }).first();
  const fileLabel = kind === "qualification" ? "Primary certificate file" : "Evidence file";
  await updated.getByLabel(fileLabel, { exact: true }).setInputFiles({
    ...PNG_FILE,
    name: `${kind}-proof.png`
  });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    updated.getByRole("button", { name: "Upload file" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  const ready = page.locator("article").filter({ hasText: title }).first();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    ready.getByRole("button", { name: "Submit this version" }).click()
  ]);
  await page.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
  await page.locator("article").filter({ hasText: title }).first()
    .getByText("active · submitted", { exact: true }).waitFor({ timeout: 15_000 });
}


async function reviseEvidence(page, baseUrl, kind, label, value) {
  await page.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
  const card = page.locator("article").filter({ hasText: `${kind[0].toUpperCase()}${kind.slice(1)} record` }).first();
  await card.getByRole("button", { name: "Start a new revision" }).click();
  await card.getByText("active · draft", { exact: true }).waitFor({ timeout: 15000 });
  await card.getByLabel(label, { exact: false }).first().fill(value);
  await card.getByRole("button", { name: "Save metadata" }).click();
  await card.getByText("Draft metadata saved with its current version.", { exact: true }).waitFor();
  const versionId = await card.locator('input[name="versionId"]').inputValue();
  const filename = `${kind}-corrected-${versionId}.png`;
  await card.getByLabel(kind === "qualification" ? "Primary certificate file" : "Evidence file", { exact: true }).setInputFiles({ ...PNG_FILE, name: filename });
  await card.getByRole("button", { name: "Upload file", exact: true }).click();
  await card.getByText(/uploaded.*(?:bound|queued for security scanning)/).waitFor();
  const attachedFile = card.getByText(`${filename} · ${kind === "qualification" ? "primary certificate" : `${kind} evidence`} · active`, { exact: true });
  // Local processing deliberately drains a bounded batch. Exercise the same
  // status-check control a Worker uses while queued scans finish in later batches.
  for (let attempt = 0; attempt < 20 && !(await attachedFile.count()); attempt += 1) {
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
      card.getByRole("button", { name: "Check scan status", exact: true }).click()
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await attachedFile.waitFor();
  await card.getByRole("button", { name: "Submit this version" }).click();
  await card.getByText("active · submitted", { exact: true }).waitFor();
}

async function decideQueueItem(page, baseUrl, kind, outcome, reason) {
  await page.goto(`${baseUrl}/verifier/reviews`, { waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({
    has: page.locator("td", { hasText: kind })
  }).filter({ hasText: "QUEUED" }).first();
  await row.getByRole("link", { name: "Review" }).click();
  await page.getByRole("heading", { name: "Evidence review" }).waitFor();
  await page.getByRole("button", { name: "Claim review" }).click();
  await page.getByText("ASSIGNED", { exact: true }).waitFor({ timeout: 15_000 });
  const privateNotes=`Private checks for ${kind}: issuer response is being verified.`;
  await page.getByLabel("Private draft notes",{exact:true}).fill(privateNotes);
  await Promise.all([
    page.waitForResponse(response=>response.request().method()==="POST"&&response.url().includes("/verifier/reviews/")),
    page.getByRole("button",{name:"Save draft notes",exact:true}).click()
  ]);
  await page.reload({waitUntil:"domcontentloaded"});
  assert.equal(await page.getByLabel("Private draft notes",{exact:true}).inputValue(),privateNotes);
  assert.equal(await page.locator('input[name="draftRevision"]').inputValue(),"1");
  await page.getByText("ASSIGNED",{exact:true}).waitFor();
  if(outcome==="UNABLE_TO_VERIFY"){
    await page.getByLabel("Unable to verify reason",{exact:true}).fill(reason);
    await page.getByLabel("Attempted verification methods",{exact:true}).fill("Contacted the issuing authority and checked available original records.");
    await page.getByLabel("Verification limitations",{exact:true}).fill("The issuer could not confirm the proposed details at this time.");
    await page.getByRole("button",{name:"Record unable to verify",exact:true}).click();
    await page.getByRole("heading",{name:"UNABLE TO VERIFY",exact:true}).waitFor();
  }else{
    await page.getByLabel("Decision").selectOption(outcome);
    await page.getByLabel("Reason", { exact: true }).fill(reason);
    await page.getByRole("button", { name: "Finalize review" }).click();
    await page.getByText(outcome, { exact: true }).waitFor({ timeout: 15_000 });
  }
}

test(
  "independent Worker submissions reach Verifier and approve/reject/changes-requested outcomes return to Worker UI",
  { timeout: 300_000 },
  async () => {
    const root = process.cwd();
    const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-independent-review-"));
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const environment = {
      ...process.env,
      HSE_APP_ENV: "development",
      HSE_DATABASE_DRIVER: "pglite",
      HSE_PGLITE_DATA_DIR: databaseDirectory,
      HSE_RELEASE_SHA: "independent-review-browser",
      HSE_SESSION_SECRET: "independent-review-session-secret-2026-000000000",
      HSE_AUTH_PEPPER: "independent-review-auth-pepper-2026-00000000000",
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
        await readFile("/tmp/independent-audit-credentials.json", "utf8")
      );

      if (process.env.HSE_IDENTITY_QUEUE_FAILURE === "true") {
        const faultDatabase = new PGlite(databaseDirectory);
        try {
          await faultDatabase.exec(`
            CREATE FUNCTION qa_fail_correction_queue() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.evidence_kind='identity' AND EXISTS (
                SELECT 1 FROM worker_identity_versions WHERE identity_version_id=NEW.source_version_id AND version_kind='correction'
              ) THEN RAISE EXCEPTION 'QA injected review queue failure'; END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER qa_correction_queue_failure BEFORE INSERT ON evidence_review_tasks
              FOR EACH ROW EXECUTE FUNCTION qa_fail_correction_queue();
          `);
        } finally { await faultDatabase.close(); }
      }

      let recoveryVerifierState;
      const result = await runDevelopmentServer({
        args: ["--hostname", "127.0.0.1", "--port", String(port)],
        probeUrl: `${baseUrl}/worker/login`,
        projectRoot: root,
        environment,
        probe: async ({ output }) => {
          const browser = await chromium.launch({ headless: true });
          const workerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
          const worker = await workerContext.newPage();
          const verifierContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const verifier = await verifierContext.newPage();

          try {
            await login(worker, baseUrl, credentials.worker, "worker");

            await worker.goto(`${baseUrl}/worker/identity`, { waitUntil: "domcontentloaded" });
            await worker.getByLabel("Legal first name").fill("Independent");
            await worker.getByLabel("Legal last name").fill("Worker");
            await worker.getByLabel("Date of birth").fill("1992-04-18");
            await worker.getByLabel("Nationality").fill("Pakistani");
            await worker.getByLabel("Country of residence").fill("Pakistan");
            await Promise.all([
              worker.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/identity")),
              worker.getByRole("button", { name: "Save identity details" }).click()
            ]);
            await worker.reload({ waitUntil: "domcontentloaded" });

            await uploadIdentityEvidence(worker, "Identity document", "passport.png", true);
            await uploadIdentityEvidence(worker, "Profile photo", "profile.png");
            await uploadIdentityEvidence(worker, "Selfie evidence", "selfie.png");
            await worker.reload({ waitUntil: "domcontentloaded" });
            await Promise.all([
              worker.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/identity")),
              worker.getByRole("button", { name: "Submit identity" }).click()
            ]);
            await worker.getByText("Manual review", { exact: true }).first().waitFor({ timeout: 20_000 });

            await createEvidence(worker, baseUrl, "qualification", {
              inputs: [
                ["Qualification title", "NEBOSH International General Certificate"],
                ["Category", "Occupational Health and Safety"],
                ["Issuing organization", "NEBOSH"],
                ["Certificate / candidate number", "QUAL-INDEPENDENT-001"],
                ["Level", "Level 3"],
                ["Issue date", "2025-02-01"],
                ["Country", "United Kingdom"]
              ],
              checks: ["I confirm these qualification details"]
            });
            await createEvidence(worker, baseUrl, "experience", {
              inputs: [
                ["Company / organization", "Independent Safety Services"],
                ["Role / activity", "Safety Officer"],
                ["Country", "Pakistan"],
                ["Start date", "2022-01-01"],
                ["Duties / experience detail", "Permit-to-work reviews and site safety inspections."]
              ],
              selects: [["Status", "current"]]
            });
            await createEvidence(worker, baseUrl, "skill", {
              inputs: [
                ["Skill", "Permit to Work"],
                ["Category", "Safety systems"],
                ["Proficiency claim", "Advanced"],
                ["Experience (months)", "48"],
                ["Related trade", "HSE"]
              ]
            });
            await createEvidence(worker, baseUrl, "employment", {
              inputs: [
                ["Employer", "Independent Audit Employer"],
                ["Role title", "HSE Coordinator"],
                ["Country", "Pakistan"],
                ["Start date", "2023-01-01"],
                ["Duties", "Coordinate risk assessments and safe systems of work."]
              ]
            });

            await login(verifier, baseUrl, credentials.verifier, "verifier");
            await verifier.goto(`${baseUrl}/verifier/reviews`, { waitUntil: "domcontentloaded" });
            const queueText = await verifier.locator("main").innerText();
            for (const kind of ["identity", "qualification", "experience", "skill", "employment"]) {
              assert.match(queueText, new RegExp(`\\b${kind}\\b`, "i"), `${kind} was missing from Verifier queue.`);
            }

            if(process.env.HSE_INITIAL_IDENTITY_REJECTION === "true") {
              console.log("SCENARIO: initial identity rejection remains terminal and issues no Worker ID");
              await decideQueueItem(verifier,baseUrl,"identity","REJECTED","The supplied identity evidence cannot establish the claimed legal identity.");
              await worker.goto(`${baseUrl}/worker/identity`);
              await worker.getByText("Rejected",{exact:true}).first().waitFor();
              await worker.getByText("The supplied identity evidence cannot establish the claimed legal identity.",{exact:true}).waitFor();
              for(const name of ["Save identity details","Submit identity","Start identity revision","Start correction version"]) assert.equal(await worker.getByRole("button",{name,exact:true}).count(),0,"Rejected identity exposed "+name);
              await worker.goto(`${baseUrl}/worker/dashboard`);
              assert.doesNotMatch(await worker.locator("main").innerText(),/worker_id_[A-Za-z0-9_-]{24}/,"Rejected identity acquired a permanent Worker ID");
              return;
            }
            if(process.env.HSE_INITIAL_IDENTITY_MORE_INFO === "true") {
              console.log("SCENARIO: initial identity changes requested -> revised submission -> approval");
              await decideQueueItem(verifier,baseUrl,"identity","CHANGES_REQUESTED","The document photograph needs correction before the initial identity can be verified.");
              await worker.goto(`${baseUrl}/worker/identity`);
              await worker.getByText("More information required",{exact:true}).first().waitFor({timeout:15000});
              await worker.getByText("The document photograph needs correction before the initial identity can be verified.",{exact:true}).waitFor({timeout:10000});
              await worker.getByRole("button",{name:"Start identity revision",exact:true}).click({timeout:15000});
              await worker.getByRole("button",{name:"Save identity details",exact:true}).waitFor();
              await worker.getByLabel("Legal first name",{exact:true}).fill("Independent");
              await worker.getByRole("button",{name:"Save identity details",exact:true}).click();
              await worker.getByText("Identity details saved.",{exact:true}).waitFor();
              await uploadIdentityEvidence(worker,"Identity document","corrected-passport.png",true);
              await worker.getByRole("button",{name:"Submit identity",exact:true}).click();
              await worker.getByText("Manual review",{exact:true}).first().waitFor({timeout:20000});
            }
            await decideQueueItem(
              verifier,
              baseUrl,
              "identity",
              "APPROVED",
              "Identity document, photo and submitted details are consistent and verifiable."
            );
            await decideQueueItem(
              verifier,
              baseUrl,
              "qualification",
              "APPROVED",
              "Qualification evidence is attributable, current and independently verifiable."
            );
            await decideQueueItem(
              verifier,
              baseUrl,
              "experience",
              "REJECTED",
              "Experience evidence does not sufficiently substantiate the claimed role and duties."
            );
            await decideQueueItem(
              verifier,
              baseUrl,
              "skill",
              "CHANGES_REQUESTED",
              "Provide additional evidence showing practical use of the claimed skill."
            );
            await decideQueueItem(
              verifier,
              baseUrl,
              "employment",
              "APPROVED",
              "Employment evidence supports the claimed current employer and role."
            );

            await worker.goto(`${baseUrl}/worker/identity`, { waitUntil: "domcontentloaded" });
            await worker.getByText("Verified", { exact: true }).first().waitFor({ timeout: 15_000 });
            const permanentWorkerId = (await worker.locator("main").getByText(/^worker_id_[A-Za-z0-9_-]{24}$/).first().innerText()).trim();
            assert.match(permanentWorkerId, /^worker_id_[A-Za-z0-9_-]{24}$/);
            await worker.goto(`${baseUrl}/worker/dashboard`, { waitUntil: "domcontentloaded" });
            await worker.getByRole("button", { name: "Copy Worker ID" }).click();
            await worker.locator(".copy-feedback").getByText("Worker ID copied.", { exact: true }).waitFor({ timeout: 15_000 });
            assert.equal(await worker.evaluate(() => navigator.clipboard.readText()), permanentWorkerId);

            await worker.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
            const mainText = await worker.locator("main").innerText();
            assert.match(mainText, /Independent verification: approved/i);
            assert.match(mainText, /Independent verification: rejected/i);
            assert.match(mainText, /Independent verification: changes requested/i);
            assert.match(mainText, /Experience evidence does not sufficiently substantiate/i);
            assert.match(mainText, /Provide additional evidence showing practical use/i);


            if (process.env.HSE_IDENTITY_QUEUE_FAILURE !== "true") {
            for (const [kind,label,value] of [["experience","Duties / experience detail","Corrected experience supported by attributable site records."],["skill","Proficiency claim","Evidence verified practical proficiency"]]) {
              console.log("SCENARIO: correct and resubmit " + kind);
              await reviseEvidence(worker, baseUrl, kind, label, value);
              await decideQueueItem(verifier, baseUrl, kind, "APPROVED", "Corrected version independently verified with retained original history.");
              await worker.goto(`${baseUrl}/worker/evidence`);
              await worker.locator("article").filter({hasText: `${kind[0].toUpperCase()}${kind.slice(1)} record`}).first().getByText(/Independent verification: approved/).waitFor();
            }


            for (const [kind,label] of [["qualification","Qualification title"],["experience","Duties / experience detail"],["skill","Proficiency claim"],["employment","Duties"]]) {
              for (const outcome of ["REJECTED","CHANGES_REQUESTED","APPROVED"]) {
                console.log("SCENARIO: " + kind + " revision -> " + outcome);
                await reviseEvidence(worker, baseUrl, kind, label, kind === "qualification" ? "NEBOSH International General Certificate" : "Versioned evidence supports the claimed work and requires independent review.");
                await decideQueueItem(verifier, baseUrl, kind, outcome, "Reasoned " + outcome.toLowerCase() + " decision against the exact revised source and retained prior evidence.");
                await worker.goto(`${baseUrl}/worker/evidence`);
                const card = worker.locator("article").filter({hasText:`${kind[0].toUpperCase()}${kind.slice(1)} record`}).first();
                await card.getByText("Independent verification: " + outcome.toLowerCase().replaceAll("_"," ") + ".",{exact:true}).waitFor();
                await card.getByRole("heading",{name:"Version and file history"}).waitFor();
              }
            }

            await worker.goto(`${baseUrl}/worker/identity`);
            }
            await worker.goto(`${baseUrl}/worker/identity`);
            console.log("SCENARIO: verified identity correction");
            await worker.getByLabel("Reason for correction").fill("Correct legal name spelling while preserving permanent Worker identity.");
            await worker.getByRole("button", {name:"Start correction version"}).click();
            await worker.getByLabel("Legal first name").fill("Independent Corrected");
            await worker.getByRole("button", {name:"Save identity details"}).click();
            await worker.getByText("Identity details saved.", {exact:false}).waitFor();
            await uploadIdentityEvidence(worker, "Identity document", "corrected-passport.png", true);
            await uploadIdentityEvidence(worker, "Profile photo", "corrected-profile.png");
            await uploadIdentityEvidence(worker, "Selfie evidence", "corrected-selfie.png");
            if (process.env.HSE_IDENTITY_QUEUE_FAILURE === "true") {
              await Promise.all([worker.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/worker/identity")), worker.getByRole("button", {name:"Submit correction"}).click()]);
              await worker.getByRole("button", {name:"Submit correction"}).waitFor({timeout:15000});
              await worker.goto(`${baseUrl}/worker/identity`);
              assert.equal(await worker.getByRole("button", {name:"Submit correction",exact:true}).count(),1,
                "Queue failure froze the correction without a safe submission retry.");
              recoveryVerifierState = await verifierContext.storageState();
              return;
            }
            await worker.getByRole("button", {name:"Submit correction"}).click();
            await worker.getByText("Awaiting authorized decision", {exact:true}).waitFor();
            await verifier.goto(`${baseUrl}/verifier/reviews`);
            await verifier.locator("tbody tr").filter({hasText:"identity"}).filter({hasText:"QUEUED"}).first().waitFor({timeout:15000});
            await decideQueueItem(verifier, baseUrl, "identity", "APPROVED", "Corrected legal spelling verified against new document and original identity history.");
            await worker.goto(`${baseUrl}/worker/identity`);
            await worker.getByText("Verified", {exact:true}).first().waitFor();
            assert.equal(await worker.getByLabel("Legal first name").inputValue(), "Independent Corrected");
            await worker.getByText(permanentWorkerId, {exact:true}).waitFor();


            for (const outcome of ["REJECTED", "CHANGES_REQUESTED", "UNABLE_TO_VERIFY"]) {
              console.log("SCENARIO: identity correction -> " + outcome + " preserves verified parent");
              await worker.getByLabel("Reason for correction").fill("Request another correction for independent review while retaining the approved identity.");
              await worker.getByRole("button", {name:"Start correction version"}).click();
              await worker.getByRole("button", {name:"Submit correction"}).waitFor();
              await worker.getByRole("button", {name:"Submit correction"}).click();
              await worker.getByText("Awaiting authorized decision", {exact:true}).waitFor();
              await decideQueueItem(verifier, baseUrl, "identity", outcome, "Proposed correction cannot be accepted; original verified identity and permanent identifier remain valid.");
              await worker.goto(`${baseUrl}/worker/identity`);
              await worker.getByText("Verified", {exact:true}).first().waitFor();
              assert.equal(await worker.getByLabel("Legal first name").inputValue(), "Independent Corrected");
              await worker.getByText(permanentWorkerId, {exact:true}).waitFor();
              await worker.getByText(outcome==="UNABLE_TO_VERIFY"?"Latest correction: unable to verify":"Latest correction: rejected", {exact:true}).waitFor();
            }
            await worker.goto(`${baseUrl}/worker/evidence`);

            const employment = worker.locator("article").filter({ hasText: "Employment record" }).first();
            await employment.getByLabel("Employment end date").fill("2026-09-01");
            await employment.getByLabel("End reason").fill("Employment ended after project completion.");
            await Promise.all([
              worker.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
              employment.getByRole("button", { name: "End employment and preserve history" }).click()
            ]);
            await worker.reload({ waitUntil: "domcontentloaded" });
            const ended = worker.locator("article").filter({ hasText: "Employment record" }).first();
            await ended.getByText("ended · submitted", { exact: true }).waitFor({ timeout: 15_000 });
            await ended.getByText(/Independent verification: queued/i).waitFor({ timeout: 15_000 });
            await ended.getByLabel("Leaving letter file").setInputFiles({
              ...PNG_FILE,
              name: "leaving-letter.png"
            });
            await Promise.all([
              worker.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
              ended.getByRole("button", { name: "Upload leaving letter" }).click()
            ]);
            await worker.reload({ waitUntil: "domcontentloaded" });
            await worker.getByText(/Leaving letter: .* · active/).waitFor({ timeout: 15_000 });

            await worker.goto(`${baseUrl}/worker/dashboard`, { waitUntil: "domcontentloaded" });
            await worker.getByRole("heading", { level: 1, name: /Welcome,/ }).waitFor({ timeout: 20_000 });
            await worker.getByText(permanentWorkerId, { exact: true }).waitFor({ timeout: 20_000 });
            await worker.getByText("Verified", { exact: true }).first().waitFor({ timeout: 20_000 });
            const dashboardText = await worker.locator("main").innerText();
            assert.match(dashboardText, /Verified/i);
            assert.ok(dashboardText.includes(permanentWorkerId), "Permanent Worker ID was missing from the Worker dashboard.");
            assert.doesNotMatch(dashboardText, /HSE-REG-/);
            assert.match(dashboardText, /Qualifications[\s\S]*1 verified/i);
            assert.match(dashboardText, /0 need changes/i);
            assert.match(dashboardText, /0 rejected/i);
          } catch (error) {
            throw new Error(error.message + "\nSERVER:\n" + output().slice(-16000), {cause:error});
          } finally {
            await workerContext.close();
            await verifierContext.close();
            await browser.close();
          }
        }
      });

      assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

      if (process.env.HSE_IDENTITY_QUEUE_FAILURE === "true") {
        const recoveredDatabase = new PGlite(databaseDirectory);
        try {
          const current = (await recoveredDatabase.query("SELECT versions.version_status FROM worker_identities identities JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id AND versions.version_number=identities.current_version_number WHERE worker_account_id='audit_worker_account_20260901'")).rows[0];
          assert.equal(current.version_status,"draft","Failed queue must roll back correction submission");
          await recoveredDatabase.exec("DROP TRIGGER qa_correction_queue_failure ON evidence_review_tasks; DROP FUNCTION qa_fail_correction_queue();");
        } finally { await recoveredDatabase.close(); }
        const recovery = await runDevelopmentServer({
          args: ["--hostname", "127.0.0.1", "--port", String(port)], probeUrl: `${baseUrl}/worker/login`,
          projectRoot: root, environment,
          probe: async () => {
            const browser = await chromium.launch({headless:true});
            try {
              const worker = await browser.newPage();
              const verifierContext = await browser.newContext({storageState:recoveryVerifierState});
              const verifier = await verifierContext.newPage();
              await login(worker,baseUrl,credentials.worker,"worker");
              await worker.goto(`${baseUrl}/worker/identity`);
              await worker.getByRole("button",{name:"Submit correction",exact:true}).click();
              await worker.getByText("Awaiting authorized decision",{exact:true}).waitFor();
              await verifier.goto(`${baseUrl}/verifier/reviews`);
              await decideQueueItem(verifier,baseUrl,"identity","APPROVED","Recovered queue successfully delivered the original corrected identity for independent review.");
              await worker.goto(`${baseUrl}/worker/identity`);
              await worker.getByText("Verified",{exact:true}).first().waitFor();
              assert.equal(await worker.getByLabel("Legal first name").inputValue(),"Independent Corrected");
              console.log("SCENARIO: queue failure -> preserved draft -> retry -> Verifier approval");
            } finally { await browser.close(); }
          }
        });
        assert.equal(recovery.requestedSignal,"SMOKE_COMPLETE");
      }

      const database = new PGlite(databaseDirectory);
      try {
        if (process.env.HSE_IDENTITY_QUEUE_FAILURE === "true") {
          assert.equal((await database.query("SELECT lifecycle_status FROM worker_identities WHERE worker_account_id='audit_worker_account_20260901'")).rows[0].lifecycle_status,"verified");
          const reviews = (await database.query("SELECT task_status FROM evidence_review_tasks tasks JOIN worker_identity_versions versions ON versions.identity_version_id=tasks.source_version_id WHERE versions.version_kind='correction'")).rows;
          assert.deepEqual(reviews.map(row=>row.task_status),["APPROVED"]);
          assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM worker_identity_worker_ids WHERE worker_account_id='audit_worker_account_20260901'")).rows[0].count,1);
          return;
        }
        if(process.env.HSE_INITIAL_IDENTITY_REJECTION === "true") {
          const identity=(await database.query("SELECT lifecycle_status FROM worker_identities WHERE worker_account_id='audit_worker_account_20260901'")).rows[0];
          assert.equal(identity.lifecycle_status,"rejected");
          assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM worker_identity_worker_ids WHERE worker_account_id='audit_worker_account_20260901'")).rows[0].count,0);
          assert.equal((await database.query("SELECT task_status FROM evidence_review_tasks WHERE worker_account_id='audit_worker_account_20260901' AND evidence_kind='identity'")).rows[0].task_status,"REJECTED");
          return;
        }
        const taskResult = await database.query(
          `SELECT evidence_kind,task_status
             FROM evidence_review_tasks
            WHERE worker_account_id='audit_worker_account_20260901'
            ORDER BY evidence_kind`
        );
        const statusesByKind = taskResult.rows.reduce((accumulator, row) => {
          const current = accumulator.get(row.evidence_kind) ?? [];
          current.push(row.task_status);
          accumulator.set(row.evidence_kind, current);
          return accumulator;
        }, new Map());
        assert.deepEqual([...statusesByKind.get("identity")].sort(), (process.env.HSE_INITIAL_IDENTITY_MORE_INFO === "true" ? ["APPROVED", "APPROVED", "CHANGES_REQUESTED", "CHANGES_REQUESTED", "REJECTED", "UNABLE_TO_VERIFY"] : ["APPROVED", "APPROVED", "CHANGES_REQUESTED", "REJECTED", "UNABLE_TO_VERIFY"]));
        for (const kind of ["qualification", "experience", "skill", "employment"]) {
          const statuses = statusesByKind.get(kind);
          for (const outcome of ["APPROVED", "REJECTED", "CHANGES_REQUESTED"]) assert.ok(statuses.includes(outcome), kind + " missing " + outcome);
        }
        assert.deepEqual(
          [...(statusesByKind.get("employment") ?? [])].sort(),
          ["APPROVED", "APPROVED", "CHANGES_REQUESTED", "QUEUED", "REJECTED"]
        );

        const identity = await database.query(
          `SELECT lifecycle_status
             FROM worker_identities
            WHERE worker_account_id='audit_worker_account_20260901'`
        );
        assert.equal(identity.rows[0]?.lifecycle_status, "verified");

        const leaving = await database.query(
          `SELECT status
             FROM worker_employment_leaving_letters
            WHERE employment_record_id IN (
              SELECT record_id FROM worker_evidence_records
              WHERE worker_account_id='audit_worker_account_20260901'
                AND record_kind='employment'
            )`
        );
        assert.equal(leaving.rows[0]?.status, "active");
      } finally {
        await database.close();
      }
    } finally {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  }
);