import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";
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

test("staging refuses anonymous integrity event reads and writes even on a development server", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "hse-integrity-staging-auth-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  try {
    const database = await openScriptDatabase({ databaseDriver: "pglite", pgliteDataDir: directory });
    try {
      await applyPendingMigrations(database, "integrity-staging-auth-boundary-test");
    } finally {
      await database.close();
    }
    await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      projectRoot: process.cwd(),
      environment: {
        ...process.env,
        HSE_APP_ENV: "staging",
        HSE_ENABLE_INTEGRITY_DEV_FIXTURE: "true",
        HSE_DATABASE_DRIVER: "pglite",
        HSE_PGLITE_DATA_DIR: directory,
        HSE_SESSION_SECRET: "synthetic-integrity-staging-auth-session-long-enough",
        HSE_AUTH_PEPPER: "synthetic-integrity-staging-auth-pepper-long-enough",
        NEXT_TELEMETRY_DISABLED: "1"
      },
      probeUrl: base + "/api/integrity/snapshot",
      probe: async () => {
        const get = await fetch(base + "/api/integrity/snapshot");
        const post = await fetch(base + "/api/integrity/snapshot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "SCREEN_UNAVAILABLE", occurredAt: new Date().toISOString() })
        });
        const payload = await post.json().catch(() => ({}));
        console.log("STAGING_INTEGRITY_AUTH_BOUNDARY", JSON.stringify({
          get: get.status,
          post: post.status,
          wroteEvent: Boolean(payload.event?.eventId)
        }));
        assert.equal(get.status, 401, "Anonymous staging GET must fail closed");
        assert.equal(post.status, 401, "Anonymous staging POST must not forge proctoring events");
        assert.equal(Boolean(payload.event?.eventId), false, "No event may be created");
      }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
