import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

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
      HSE_RELEASE_SHA: "interview-live-media-browser",
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
        await readFile("/tmp/independent-audit-credentials.json", "utf8")
      );
      const interviewRequestId = "interview_request_live_browser_20260925";
      const scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();

      const seedDatabase = new PGlite(databaseDirectory);
      try {
        await seedDatabase.query(
          `INSERT INTO interview_requests(
             interview_request_id,tenant_id,case_id,worker_account_id,status,
             requested_at,scheduled_at,assessor_account_id,timezone
           ) VALUES($1,$2,$3,$4,'ASSIGNED',$5,$6,$7,'Asia/Karachi')`,
          [
            interviewRequestId,
            credentials.company.tenantId,
            "assurance_case_live_browser_20260925",
            credentials.worker.accountId,
            new Date().toISOString(),
            scheduledAt,
            credentials.assessor.accountId
          ]
        );
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
          const worker = await workerContext.newPage();
          const assessor = await assessorContext.newPage();
          const errors = [];
          for (const page of [worker, assessor]) {
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("console", (message) => {
              if (message.type() === "error") errors.push(message.text());
            });
          }

          try {
            await login(worker, baseUrl, credentials.worker, "worker");
            await login(assessor, baseUrl, credentials.assessor, "assessor");

            await worker.goto(
              `${baseUrl}/worker/interviews/${interviewRequestId}`,
              { waitUntil: "domcontentloaded" }
            );
            await worker
              .getByRole("button", { name: "I'm ready — enter waiting room" })
              .click();
            await worker.reload({ waitUntil: "domcontentloaded" });
            await worker
              .getByText("Camera, microphone and live interview", { exact: true })
              .waitFor();

            await assessor.goto(
              `${baseUrl}/assessor/interviews/${interviewRequestId}`,
              { waitUntil: "domcontentloaded" }
            );
            await assessor.getByText("Provider: Built-in WebRTC", { exact: true }).waitFor();
            await assessor
              .getByLabel(/I consent to camera and microphone use/i)
              .check();
            await assessor
              .getByRole("button", { name: "Enable camera & microphone" })
              .click();
            await assessor
              .getByText("Waiting for worker to join", { exact: true })
              .waitFor({ timeout: 20_000 });

            await worker
              .getByLabel(/I consent to camera and microphone use/i)
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

            assert.deepEqual(
              errors.filter((message) => !message.includes("favicon")),
              [],
              `Unexpected browser errors:\n${errors.join("\n")}\n${output()}`
            );
          } finally {
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
