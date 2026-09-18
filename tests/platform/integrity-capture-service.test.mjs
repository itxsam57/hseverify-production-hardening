import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

async function prepareIntegrityDatabase() {
  const dataDirectory = await mkdtemp(join(tmpdir(), "hse-m2-09-integrity-"));
  const environment = { databaseDriver: "pglite", pgliteDataDir: dataDirectory };
  const database = await openScriptDatabase(environment);
  await applyPendingMigrations(database, "m2-09-integrity-test");
  await database.close();
  return { HSE_DATABASE_DRIVER: "pglite", HSE_PGLITE_DATA_DIR: dataDirectory };
}

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

test("M2.09 integrity capture runtime preserves degraded and recovered states", async () => {
  const environment = await prepareIntegrityDatabase();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await runDevelopmentServer({
    args: ["--port", String(port)],
    environment: { ...process.env, ...environment },
    probeUrl: `${baseUrl}/api/integrity/snapshot`,
    probe: async () => {
      const degraded = await fetch(`${baseUrl}/api/integrity/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "CAMERA_UNAVAILABLE", occurredAt: "2026-09-12T09:00:00.000Z" })
      });
      const recovered = await fetch(`${baseUrl}/api/integrity/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "BROWSER_RESUMED", occurredAt: "2026-09-12T09:01:00.000Z" })
      });

      assert.equal((await degraded.json()).event.state, "DEGRADED");
      assert.equal((await recovered.json()).event.state, "RECOVERED");
    }
  });
});

test("M2.09 integrity capture classifies prohibited interaction signals", async () => {
  const environment = await prepareIntegrityDatabase();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await runDevelopmentServer({
    args: ["--port", String(port)],
    environment: { ...process.env, ...environment },
    probeUrl: `${baseUrl}/api/integrity/snapshot`,
    probe: async () => {
      const response = await fetch(`${baseUrl}/api/integrity/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "COPY_PASTE_DETECTED", occurredAt: "2026-09-12T09:03:00.000Z" })
      });
      const body = await response.json();
      assert.equal(body.event.classification, "RED");
      assert.equal(body.event.type, "COPY_PASTE_DETECTED");
    }
  });
});

test("M2.09 integrity capture accepts canonical browser and identity signal classes", async () => {
  const environment = await prepareIntegrityDatabase();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await runDevelopmentServer({
    args: ["--port", String(port)],
    environment: { ...process.env, ...environment },
    probeUrl: `${baseUrl}/api/integrity/snapshot`,
    probe: async () => {
      const response = await fetch(`${baseUrl}/api/integrity/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "IDENTITY_RECONFIRMATION_REQUIRED", occurredAt: "2026-09-12T09:04:00.000Z" })
      });
      const body = await response.json();
      assert.equal(body.event.type, "IDENTITY_RECONFIRMATION_REQUIRED");
      assert.equal(body.event.classification, "RED");
    }
  });
});
