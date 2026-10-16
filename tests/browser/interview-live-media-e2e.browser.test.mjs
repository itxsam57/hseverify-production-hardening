import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { seedConsoleFile, seedConsoleEvidence, seedConsoleIdentity } from "../helpers/interview-console-file-fixture.mjs";
import { authorizeReviewFixture } from "../helpers/evidence-review-calibration-fixture.mjs";
import { loadWorkerRegistrationTs, setWorkerRegistrationRuntimeEnvironment } from "../helpers/worker-registration-runtime-loader.mjs";
const { EvidenceReviewService } = loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const { AuthAccessRepository } = loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const { FilesystemPrivateObjectStorage } = loadWorkerRegistrationTs("src/lib/secure-files/private-object-storage.ts");
const hash = value => createHash("sha256").update(value).digest("hex");

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

test(
  "Worker and assigned Assessor establish built-in WebRTC interview media in Chromium",
  { timeout: 180_000 },
  async () => {
    const root = process.cwd();
    const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-interview-media-browser-"));
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const environment = {
      ...process.env,
      HSE_APP_ENV: "development",
      HSE_DATABASE_DRIVER: "pglite",
      HSE_PGLITE_DATA_DIR: databaseDirectory,
      HSE_RUNTIME_PROJECT_ROOT: databaseDirectory,
      HSE_RELEASE_SHA: "interview-console-browser",
      HSE_AUDIT_CREDENTIALS_PATH: join(databaseDirectory, "credentials.json"),
      HSE_SESSION_SECRET: "interview-media-session-secret-2026-000000000000",
      HSE_AUTH_PEPPER: "interview-media-auth-pepper-2026-0000000000000",
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
      const interviewRequestId = "interview_request_live_browser_20260925";
      const orderId = "assurance_order_" + "i".repeat(24);
      const targetId = "assurance_target_" + "j".repeat(24);
      const caseId = "assurance_case_" + "k".repeat(24);
      const workerLinkId = "worker_link_live_browser_20260925";
      const scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();
      const requestedAt = new Date().toISOString();

      let queuedEvidence, approvedFile, unrelatedFile, verifiedIdentity;
      const seedDatabase = new PGlite(databaseDirectory);
      try {
        await seedDatabase.query(
          `INSERT INTO assurance_orders(
             order_id,tenant_id,created_by_membership_id,order_name,order_reference,order_status,requested_evidence_checks,interview_required
           ) VALUES($1,$2,$3,'Live interview browser order','LIVE-INTERVIEW-BROWSER','DRAFT','["qualification","employment"]',TRUE)`,
          [
            orderId,
            credentials.company.tenantId,
            "membership_live_interview_browser"
          ]
        );
        await seedDatabase.query(
          `INSERT INTO assurance_order_workers(
             target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status
           ) VALUES($1,$2,$3,$4,$5,'company','eligible')`,
          [
            targetId,
            orderId,
            credentials.company.tenantId,
            workerLinkId,
            credentials.worker.accountId
          ]
        );
        await seedDatabase.query(
          `INSERT INTO assurance_cases(
             case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
             case_status,owner_kind,next_action
           ) VALUES($1,$2,$3,$4,$5,$6,'Interview pending','assessor','Conduct the assigned structured interview.')`,
          [
            caseId,
            orderId,
            targetId,
            credentials.company.tenantId,
            workerLinkId,
            credentials.worker.accountId
          ]
        );
        await seedDatabase.query(
          `INSERT INTO interview_requests(
             interview_request_id,tenant_id,case_id,worker_account_id,status,
             requested_at,scheduled_at,assessor_account_id,timezone
           ) VALUES($1,$2,$3,$4,'ASSIGNED',$5,$6,$7,'Asia/Karachi')`,
          [
            interviewRequestId,
            credentials.company.tenantId,
            caseId,
            credentials.worker.accountId,
            requestedAt,
            scheduledAt,
            credentials.assessor.accountId
          ]
        );
        await seedDatabase.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[caseId,interviewRequestId]);
        verifiedIdentity=await seedConsoleIdentity(seedDatabase,credentials.worker.accountId,"Browser identity");
        approvedFile=await seedConsoleFile(seedDatabase,credentials.worker.accountId,"Browser qualification");
        unrelatedFile=await seedConsoleFile(seedDatabase,credentials.worker.accountId,"Unrelated private");
        await seedConsoleEvidence(seedDatabase,credentials.worker.accountId,"qualification","Browser",{file:approvedFile});
        await seedConsoleEvidence(seedDatabase,credentials.worker.accountId,"employment","Browser");
        await new FilesystemPrivateObjectStorage({
          trustedBasePath:databaseDirectory,rootPath:join(databaseDirectory,".data","private-objects")
        }).put(approvedFile.objectKey,approvedFile.bytes);
        for(const file of [verifiedIdentity.profile_photo,verifiedIdentity.selfie,verifiedIdentity.identity_document])
          await new FilesystemPrivateObjectStorage({trustedBasePath:databaseDirectory,rootPath:join(databaseDirectory,".data","private-objects")}).put(file.objectKey,file.bytes);
        const companySession="browser-console-company-"+randomUUID(),stamp=new Date().toISOString();
        await new AuthAccessRepository(seedDatabase).authentication.insertSession({
          sessionId:companySession,accountId:credentials.company.accountId,activeRole:"company",
          tokenHash:hash(companySession),csrfTokenHash:hash("csrf:"+companySession),userAgentHash:null,ipAddressHash:null,
          createdAt:stamp,lastSeenAt:stamp,expiresAt:new Date(Date.now()+3600000).toISOString()
        });
        setWorkerRegistrationRuntimeEnvironment({appEnvironment:"development",sessionSecret:environment.HSE_SESSION_SECRET});
        assert.equal(await new EvidenceReviewService(seedDatabase).queueCaseEvidence({
          sessionId:companySession,accountId:credentials.company.accountId,activeRole:"company",accountStatus:"active",
          authorizedTenantPermission:"company.orders.manage",
          tenantMembership:{tenantId:credentials.company.tenantId,tenantStatus:"active",membershipId:credentials.company.membershipId,role:"owner",status:"active",overrides:[]}
        },caseId),2);
        queuedEvidence=(await seedDatabase.query("SELECT task_id,evidence_kind FROM evidence_review_tasks WHERE case_id=$1 ORDER BY evidence_kind",[caseId])).rows;
        for (const task of queuedEvidence) {
          await authorizeReviewFixture(seedDatabase,{taskId:task.task_id,verifiers:[{accountId:credentials.verifier.accountId}],assessors:[{accountId:credentials.assessor.accountId}],at:new Date()});
        }

      } finally {
        await seedDatabase.close();
      }

      const result = await runDevelopmentServer({
        args: ["--hostname", "127.0.0.1", "--port", String(port)],
        probeUrl: `${baseUrl}/worker/login`,
        projectRoot: root,
        environment,
        probe: async ({ output }) => {
          const browser = await chromium.launch({
            headless: true,
            args: [
              "--use-fake-device-for-media-stream",
              "--use-fake-ui-for-media-stream"
            ]
          });
          const workerContext = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            permissions: ["camera", "microphone"]
          });
          const assessorContext = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            permissions: ["camera", "microphone"]
          });
          const verifierContext=await browser.newContext({viewport:{width:1280,height:900}});
          const verifier=await verifierContext.newPage();
          const worker = await workerContext.newPage();
          const assessor = await assessorContext.newPage();
          const errors = [];
          for (const page of [worker, assessor, verifier]) {
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("console", (message) => {
              if (message.type() === "error") errors.push(message.text());
            });
          }

          try {
            await login(worker, baseUrl, credentials.worker, "worker");
            await login(assessor, baseUrl, credentials.assessor, "assessor");
            await login(verifier,baseUrl,credentials.verifier,"verifier");
            for(const task of queuedEvidence) {
              await verifier.goto(baseUrl+"/verifier/reviews/"+task.task_id,{waitUntil:"domcontentloaded"});
              const before=await verifier.request.get(baseUrl+"/verifier/reviews/"+task.task_id+"/preview");
              assert.equal(before.status(),404,"Unclaimed evidence must not expose private file bytes.");
              await verifier.getByRole("button",{name:"Claim review",exact:true}).click();
              await verifier.getByRole("button",{name:"Finalize review",exact:true}).waitFor();
              const share=verifier.getByLabel("Share this reason with the assigned Assessor",{exact:true});
              assert.equal(await share.isChecked(),false,"Reviewer comments must default to private.");
              if(task.evidence_kind==="qualification") {
                const preview=await verifier.request.get(baseUrl+"/verifier/reviews/"+task.task_id+"/preview");
                assert.equal(preview.status(),200);assert.deepEqual(await preview.body(),approvedFile.bytes);
                assert.match(preview.headers()["cache-control"],/private.*no-store/);
                await share.check();
              }
              await verifier.getByLabel("Reason",{exact:true}).fill(task.evidence_kind==="qualification"?"Shared browser qualification reason.":"Private browser employment reason.");
              await verifier.getByRole("button",{name:"Finalize review",exact:true}).click();
              await verifier.getByRole("button",{name:"Finalize review",exact:true}).waitFor({state:"hidden"});
              await verifier.getByText("APPROVED",{exact:true}).waitFor();
            }


            await worker.goto(
              `${baseUrl}/worker/interviews/${interviewRequestId}`,
              { waitUntil: "domcontentloaded" }
            );
            await worker
              .getByRole("button", { name: "Enter waiting room" })
              .click();
            await worker.reload({ waitUntil: "domcontentloaded" });
            await worker
              .getByRole("button", { name: "Check camera, microphone & connection" })
              .click();
            await worker
              .getByText("Camera, microphone and connection checks passed.", { exact: true })
              .waitFor({ timeout: 20_000 });
            await worker
              .getByLabel(/I confirm I am the Worker assigned to this interview/i)
              .check();
            await worker
              .getByRole("button", { name: "Ready for Interview" })
              .click();
            await worker
              .getByText(/Ready checks and required consent are recorded/i)
              .waitFor({ timeout: 20_000 });

            const assignedDetail = await assessor.goto(
              `${baseUrl}/assessor/interviews/${interviewRequestId}`,
              { waitUntil: "domcontentloaded" }
            );
            assert.equal(assignedDetail.status(),200,"Calibrated assigned Assessor must reach its real interview detail.");
            await assessor
              .getByRole("button", { name: "Claim interview" })
              .click();
            await assessor.reload({ waitUntil: "domcontentloaded" });
            await assessor
              .getByRole("button", { name: "Admit ready Worker" })
              .click();
            await assessor.reload({ waitUntil: "domcontentloaded" });
            await assessor
              .getByRole("button", { name: "Start interview" })
              .click();
            await assessor.reload({ waitUntil: "domcontentloaded" });
            await assessor.getByText("Provider: Built-in WebRTC", { exact: true }).waitFor();

            await worker.reload({ waitUntil: "domcontentloaded" });
            await worker
              .getByText("Camera, microphone and live interview", { exact: true })
              .waitFor();

            await assessor
              .getByLabel(/I allow this browser to use my camera and microphone/i)
              .check();
            await assessor
              .getByRole("button", { name: "Enable camera & microphone" })
              .click();
            await assessor
              .getByText("Waiting for worker to join", { exact: true })
              .waitFor({ timeout: 20_000 });

            await worker
              .getByLabel(/I allow this browser to use my camera and microphone/i)
              .check();
            await worker
              .getByRole("button", { name: "Enable camera & microphone" })
              .click();

            await Promise.all([
              worker
                .getByText("Live — encrypted peer connection", { exact: true })
                .waitFor({ timeout: 30_000 }),
              assessor
                .getByText("Live — encrypted peer connection", { exact: true })
                .waitFor({ timeout: 30_000 })
            ]);

            const workerTracks = await worker.locator("video").first().evaluate((video) => {
              const stream = video.srcObject;
              return stream instanceof MediaStream
                ? stream.getTracks().map((track) => ({ kind: track.kind, readyState: track.readyState }))
                : [];
            });
            const assessorTracks = await assessor.locator("video").first().evaluate((video) => {
              const stream = video.srcObject;
              return stream instanceof MediaStream
                ? stream.getTracks().map((track) => ({ kind: track.kind, readyState: track.readyState }))
                : [];
            });
            assert.deepEqual(
              workerTracks.map((track) => track.kind).sort(),
              ["audio", "video"]
            );
            assert.deepEqual(
              assessorTracks.map((track) => track.kind).sort(),
              ["audio", "video"]
            );
            assert(workerTracks.every((track) => track.readyState === "live"));
            assert(assessorTracks.every((track) => track.readyState === "live"));


            await assessor.getByRole("tab",{name:"Profile",exact:true}).click();
            const photo=assessor.getByRole("img",{name:/Profile photo of/});
            await photo.waitFor();
            await photo.scrollIntoViewIfNeeded();
            await assessor.waitForFunction(()=>{const image=document.querySelector('img[alt^="Profile photo of "]');return image?.complete&&image.naturalWidth>0;});
            assert.equal(await photo.evaluate(image=>image.complete&&image.naturalWidth>0),true,"Verified private photo must actually render.");
            const evidenceBase=baseUrl+"/assessor/interviews/"+interviewRequestId+"/evidence/";
            const photoResponse=await assessor.request.get(evidenceBase+verifiedIdentity.profile_photo.fileId);
            assert.equal(photoResponse.status(),200);assert.deepEqual(await photoResponse.body(),verifiedIdentity.profile_photo.bytes);
            assert.equal(photoResponse.headers()["content-type"],"image/png");
            for(const ref of [verifiedIdentity.selfie.fileId,verifiedIdentity.identity_document.fileId])
              assert.equal((await assessor.request.get(evidenceBase+ref)).status(),404,"Assessor context must not grant passport or selfie access.");
            await assessor.getByRole("tab",{name:"Reviewer comments",exact:true}).click();
            await assessor.getByText("Shared browser qualification reason.",{exact:true}).waitFor();
            assert.equal(await assessor.getByText("Private browser employment reason.",{exact:true}).count(),0);
            await assessor.getByRole("tab",{name:"Evidence and employment",exact:true}).click();
            await assessor.getByRole("heading",{name:"Browser qualification",exact:true}).waitFor();
            await assessor.getByText("Browser employer · Electrician",{exact:true}).waitFor();
            const previewUrl=baseUrl+"/assessor/interviews/"+interviewRequestId+"/evidence/";
            const approvedPreview=await assessor.request.get(previewUrl+approvedFile.fileId);
            assert.equal(approvedPreview.status(),200);assert.deepEqual(await approvedPreview.body(),approvedFile.bytes);
            assert.match(approvedPreview.headers()["cache-control"],/private.*no-store/);
            assert.equal(approvedPreview.headers()["x-content-type-options"],"nosniff");
            assert.equal((await assessor.request.get(previewUrl+unrelatedFile.fileId)).status(),404);
            assert.equal((await assessor.request.get(previewUrl+"secure_file_"+"x".repeat(24))).status(),404);
            await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
            const draftNotes = "Unsaved console notes must stay across internal tabs.";
            await assessor.getByLabel("Notes", {exact:true}).fill(draftNotes);
            await assessor.getByLabel("Technical knowledge", {exact:true}).fill("2");
            await assessor.locator("video").first().evaluate(video => {
              window.__consoleMediaSnapshot = {element:video,stream:video.srcObject,tracks:video.srcObject.getTracks()};
            });
            for (const name of ["Profile","Evidence and employment","Assessment","Integrity","History","Reviewer comments","Decision context","Questions","Notes and scoring"]) {
              const tab = assessor.getByRole("tab",{name,exact:true});
              await tab.click();
              await tab.and(assessor.locator('[aria-selected="true"]')).waitFor();
              assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),draftNotes);
              assert.equal(await assessor.getByLabel("Technical knowledge",{exact:true}).inputValue(),"2");
              assert.equal(await assessor.locator("video").first().evaluate(video => {
                const before=window.__consoleMediaSnapshot;
                return before.element===video && before.stream===video.srcObject &&
                  before.tracks.every(track=>track.readyState==="live"&&video.srcObject.getTracks().includes(track));
              }),true,"Tab navigation must retain the same video, MediaStream and live tracks.");
              assert.equal(await assessor.getByText("Live — encrypted peer connection",{exact:true}).count(),1);
            }
            await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).focus();
            await assessor.keyboard.press("ArrowLeft");
            await assessor.getByRole("tab",{name:"Decision context",exact:true}).and(assessor.locator('[aria-selected="true"]')).waitFor();
            await assessor.keyboard.press("Home");
            await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).and(assessor.locator('[aria-selected="true"]')).waitFor();
            await assessor.setViewportSize({width:390,height:844});
            for (const name of ["Profile","Evidence and employment","Reviewer comments","Notes and scoring"]) {
              await assessor.getByRole("tab",{name,exact:true}).click();
              await assessor.getByRole("tab",{name,exact:true}).and(assessor.locator('[aria-selected="true"]')).waitFor();
              assert(await assessor.evaluate(()=>document.documentElement.scrollWidth<=390),"390px console must not overflow horizontally.");
            }
            assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),draftNotes);
            console.log("ACTUAL_CONSOLE_TABS Browser: all9 mounted panels and keyboard navigation preserve identical WebRTC media, unsaved notes and partial scores;390px no overflow.");

            await worker.getByRole("button", { name: "Mute microphone" }).click();
            assert.equal(
              await worker.locator("video").first().evaluate((video) => {
                const stream = video.srcObject;
                return stream instanceof MediaStream ? stream.getAudioTracks()[0]?.enabled : null;
              }),
              false
            );
            await worker.getByRole("button", { name: "Unmute microphone" }).click();
            assert.equal(
              await worker.locator("video").first().evaluate((video) => {
                const stream = video.srcObject;
                return stream instanceof MediaStream ? stream.getAudioTracks()[0]?.enabled : null;
              }),
              true
            );

            await worker.getByRole("button", { name: "Turn camera off" }).click();
            assert.equal(
              await worker.locator("video").first().evaluate((video) => {
                const stream = video.srcObject;
                return stream instanceof MediaStream ? stream.getVideoTracks()[0]?.enabled : null;
              }),
              false
            );
            await worker.getByRole("button", { name: "Turn camera on" }).click();
            assert.equal(
              await worker.locator("video").first().evaluate((video) => {
                const stream = video.srcObject;
                return stream instanceof MediaStream ? stream.getVideoTracks()[0]?.enabled : null;
              }),
              true
            );

            await assessor.getByRole("button", { name: "Leave media" }).click();
            await assessor.getByText("Not connected", { exact: true }).waitFor({ timeout: 15_000 });
            await worker.getByText("Other participant left the interview", { exact: true }).waitFor({ timeout: 15_000 });

            const saveResponse = assessor.waitForResponse(response => response.request().method()==="POST" && response.url().includes("/assessor/interviews/") && response.status()===200);
            await assessor.getByRole("button",{name:"Save draft",exact:true}).click();
            await saveResponse;
            await assessor.reload({waitUntil:"domcontentloaded"});
            assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),draftNotes);
            assert.equal(await assessor.getByLabel("Technical knowledge",{exact:true}).inputValue(),"2");


            const duration=assessor.getByLabel("Interview duration",{exact:true});
            const elapsedSeconds=text=>{
              assert.match(text,/^\d+:[0-5]\d$/,"Interview duration must be a valid minutes:seconds value.");
              const [minutes,seconds]=text.split(":").map(Number);
              return minutes*60+seconds;
            };
            const waitForDurationAdvance=async baseline=>{
              await assessor.waitForFunction(({baseline})=>{
                const text=document.querySelector('output[aria-label="Interview duration"]')?.textContent??"";
                if(!/^\d+:[0-5]\d$/.test(text))return false;
                const [minutes,seconds]=text.split(":").map(Number);
                return minutes*60+seconds>baseline;
              },{baseline},{timeout:5000,polling:100});
              assert(elapsedSeconds(await duration.textContent())>baseline,"Running interview timer must increase numerically.");
            };
            const runningTime=elapsedSeconds(await duration.textContent());
            // DOMContentLoaded can precede hydration and the first timer effect.
            await waitForDurationAdvance(runningTime);
            await assessor.getByLabel("Pause reason",{exact:true}).fill("Candidate requested a short pause.");
            await assessor.getByRole("button",{name:"Pause interview",exact:true}).click();
            await assessor.getByText("· Stopped",{exact:false}).waitFor();
            const pausedTime=elapsedSeconds(await duration.textContent());
            for(let interval=0;interval<3;interval++){
              await assessor.waitForTimeout(1000);
              assert.equal(elapsedSeconds(await duration.textContent()),pausedTime,"Paused interview timer must stay stopped across multiple intervals.");
            }
            await assessor.getByRole("button",{name:"Resume interview",exact:true}).click();
            await assessor.getByText("· Running",{exact:false}).waitFor();
            const resumedTime=elapsedSeconds(await duration.textContent());
            assert(resumedTime>=pausedTime,"Resume must retain the paused duration.");
            await waitForDurationAdvance(resumedTime);
            assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),draftNotes);
            console.log("ACTUAL_CONSOLE_SHARING Private default and checked Verifier reason reach only the assigned Assessor; owned private HTTP previews, unknown/unbound404 and pause/resume timer verified.");
            assert.deepEqual(
              errors.filter((message) => !message.includes("favicon")),
              [],
              `Unexpected browser errors:\n${errors.join("\n")}\n${output()}`
            );
          } catch (error) {
            console.error("CONSOLE_SERVER_FAILURE",output().slice(-12000));
            throw error;
          } finally {
            await verifierContext.close();
            await workerContext.close();
            await assessorContext.close();
            await browser.close();
          }
        }
      });

      assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

      const database = new PGlite(databaseDirectory);
      try {
        const request = await database.query(
          `SELECT status FROM interview_requests WHERE interview_request_id=$1`,
          [interviewRequestId]
        );
        assert.equal(request.rows[0]?.status, "WAITING_ROOM");

        const visibility=(await database.query("SELECT tasks.evidence_kind,decisions.assessor_visible FROM evidence_review_decisions decisions JOIN evidence_review_tasks tasks ON tasks.task_id=decisions.task_id WHERE tasks.case_id=$1 ORDER BY tasks.evidence_kind",[caseId])).rows;
        assert.deepEqual(visibility,[{evidence_kind:"employment",assessor_visible:false},{evidence_kind:"qualification",assessor_visible:true}]);
        const runtime = await database.query(
          `SELECT status,claimed_at,worker_ready_at,admitted_at,started_at
             FROM interview_runtime_sessions
            WHERE interview_request_id=$1`,
          [interviewRequestId]
        );
        assert.equal(runtime.rows[0]?.status, "ACTIVE");
        assert(runtime.rows[0]?.claimed_at);
        assert(runtime.rows[0]?.worker_ready_at);
        assert(runtime.rows[0]?.admitted_at);
        assert(runtime.rows[0]?.started_at);

        const saved=(await database.query("SELECT notes,scorecard FROM interview_console_drafts WHERE interview_request_id=$1",[interviewRequestId])).rows[0];
        assert.equal(saved.notes.at(-1).content,"Unsaved console notes must stay across internal tabs.");
        assert.equal(saved.scorecard.technicalKnowledge,2);
        console.log("ACTUAL_CONSOLE_DRAFT DB: real Save Draft retains notes and a partial score after reload.");

        const signals = await database.query(
          `SELECT actor_role,signal_kind
             FROM interview_media_signals
            WHERE interview_request_id=$1
            ORDER BY created_at,signal_id`,
          [interviewRequestId]
        );
        assert(signals.rows.some((row) => row.actor_role === "assessor" && row.signal_kind === "offer"));
        assert(signals.rows.some((row) => row.actor_role === "worker" && row.signal_kind === "answer"));
        assert(signals.rows.some((row) => row.signal_kind === "ice"));
        assert(signals.rows.some((row) => row.actor_role === "assessor" && row.signal_kind === "leave"));
      } finally {
        await database.close();
      }
    } finally {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  }
);