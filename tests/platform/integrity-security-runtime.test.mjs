import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

async function loadDomain() {
  const dir = await mkdtemp(join(tmpdir(), "hse-integrity-domain-"));
  let source = await readFile("src/lib/integrity/integrity-domain.ts", "utf8");
  source = source.replaceAll("./integrity-domain", "./integrity-domain.mjs");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  await writeFile(join(dir, "integrity-domain.mjs"), output);
  return import(join(dir, "integrity-domain.mjs"));
}

test("integrity runtime rejects unknown signals and preserves classified events", async () => {
  const { createIntegrityEvidenceEvent, IntegrityEventInputError } = await loadDomain();

  assert.throws(
    () => createIntegrityEvidenceEvent({ eventId: "1", attemptId: "a", type: "UNKNOWN" }),
    IntegrityEventInputError
  );

  const event = createIntegrityEvidenceEvent({
    eventId: "1",
    attemptId: "a",
    type: "MIC_UNAVAILABLE",
    occurredAt: "2026-09-12T09:00:00.000Z"
  });

  assert.equal(event.type, "MIC_UNAVAILABLE");
  assert.equal(event.state, "DEGRADED");
});

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

test("integrity security boundary executes the runtime capture API", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/api/integrity/snapshot`,
    probe: async () => {
    const response = await fetch(`${baseUrl}/api/integrity/snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "SCREEN_UNAVAILABLE",
        occurredAt: "2026-09-12T09:02:00.000Z"
      })
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.event.type, "SCREEN_UNAVAILABLE");
    assert.equal(body.event.state, "DEGRADED");
    assert.equal(body.event.attemptId, "integrity-local-attempt");
    }
  });
});
