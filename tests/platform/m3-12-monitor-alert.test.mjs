import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const TOKEN = "m312-monitor-auth-test-token-000000000000";
const ALERT_TOKEN = "m312-alert-auth-test-token-000000000000";
const SHA = "3673fc42b54df50a2bd145743b04f8b63a1a445d";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return "http://127.0.0.1:" + server.address().port;
}
async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function child(env) {
  return new Promise((resolve, reject) => {
    const process = spawn(
      globalThis.process.execPath,
      ["scripts/operations/check-release-readiness.mjs"],
      { cwd: globalThis.process.cwd(), env: { ...globalThis.process.env, ...env } }
    );
    let stdout = "", stderr = "";
    process.stdout.on("data", chunk => stdout += chunk.toString());
    process.stderr.on("data", chunk => stderr += chunk.toString());
    process.on("error", reject);
    process.on("close", code => resolve({ code, stdout, stderr }));
  });
}
async function fixture(run) {
  let probeStatus = 200;
  let probeSha = SHA;
  let webhookStatus = 200;
  let webhookDelay = 0;
  const alerts = [];
  const probe = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer " + TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end('{"status":"unauthorized"}');
      return;
    }
    res.writeHead(probeStatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify(probeStatus === 200 ? { status: "ready", scope: "database_connection_only", releaseSha: probeSha } : { status: "unavailable" }));
  });
  const webhook = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    alerts.push({ body, headers: req.headers, status: webhookStatus });
    if (webhookDelay) await new Promise(resolve => setTimeout(resolve, webhookDelay));
    res.writeHead(webhookStatus);
    res.end();
  });
  const stateDir = await mkdtemp(join(tmpdir(), "hse-m312-monitor-test-"));
  try {
    const probeUrl = await listen(probe);
    const webhookUrl = await listen(webhook);
    const stateFile = join(stateDir, "incident-state.json");
    const env = {
      HSE_MONITOR_PROBE_URL: probeUrl + "/api/operations/readiness",
      HSE_MONITOR_PROBE_TOKEN: TOKEN,
      HSE_MONITOR_EXPECTED_SHA: SHA,
      HSE_MONITOR_WEBHOOK_URL: webhookUrl + "/alerts",
      HSE_MONITOR_WEBHOOK_TOKEN: ALERT_TOKEN,
      HSE_MONITOR_STATE_FILE: stateFile,
      HSE_MONITOR_ALLOW_LOOPBACK_HTTP: "true"
    };
    return await run({
      env, alerts, stateFile,
      setProbeStatus: value => { probeStatus = value; },
      setProbeSha: value => { probeSha = value; },
      setWebhookStatus: value => { webhookStatus = value; },
      setWebhookDelay: value => { webhookDelay = value; }
    });
  } finally {
    await Promise.all([close(probe), close(webhook)]);
    await rm(stateDir, { recursive: true, force: true });
  }
}

test("M3.12 monitor fails closed when the operational alert receiver is absent", async () => {
  await fixture(async ({ env, alerts }) => {
    const result = await child({ ...env, HSE_MONITOR_WEBHOOK_TOKEN: "" });
    assert.equal(result.code, 3);
    assert.equal(alerts.length, 0);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN + "|" + ALERT_TOKEN));
  });
});

test("M3.12 monitor sends real HTTP incident on failed DB readiness, suppresses duplicates, and reports recovery", async () => {
  await fixture(async ({ env, alerts, setProbeStatus, stateFile }) => {
    const healthy = await child(env);
    assert.equal(healthy.code, 0, healthy.stderr);
    assert.equal(alerts.length, 0);
    setProbeStatus(503);
    const opened = await child(env);
    assert.equal(opened.code, 2, opened.stderr);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].body.event, "incident_open");
    assert.equal(alerts[0].headers.authorization, "Bearer " + ALERT_TOKEN);
    assert.equal((await readFile(stateFile, "utf8")).includes('"phase":"open"'), true);
    const repeated = await child(env);
    assert.equal(repeated.code, 2);
    assert.equal(alerts.length, 1, "repeated outage must not flood receiver");
    setProbeStatus(200);
    const restored = await child(env);
    assert.equal(restored.code, 0, restored.stderr);
    assert.equal(alerts.length, 2);
    assert.equal(alerts[1].body.event, "incident_recovered");
    assert.equal(alerts[1].body.incidentId, alerts[0].body.incidentId);
    assert.equal(alerts[1].headers["x-idempotency-key"], alerts[0].headers["x-idempotency-key"].replace("incident_open", "incident_recovered"));
    assert.equal((await readFile(stateFile, "utf8")).includes('"phase":"clear"'), true);
  });
});

test("M3.12 monitor retries actual failed receiver acceptance using stable incident idempotency key", async () => {
  await fixture(async ({ env, alerts, stateFile, setProbeStatus, setWebhookStatus }) => {
    setProbeStatus(503);
    setWebhookStatus(502);
    const failed = await child(env);
    assert.equal(failed.code, 3);
    assert.equal(alerts.length, 1);
    assert.equal((await readFile(stateFile, "utf8")).includes('"phase":"opening"'), true);
    setWebhookStatus(204);
    const retried = await child(env);
    assert.equal(retried.code, 2);
    assert.equal(alerts.length, 2);
    assert.equal(alerts[1].headers["x-idempotency-key"], alerts[0].headers["x-idempotency-key"]);
    assert.equal(alerts[1].body.incidentId, alerts[0].body.incidentId);
  });
});

test("M3.12 monitor rejects mismatched deployed SHA and unsafe or corrupted configuration", async () => {
  await fixture(async ({ env, alerts, stateFile, setProbeSha }) => {
    setProbeSha("wrong-release-sha");
    assert.equal((await child(env)).code, 2);
    assert.equal(alerts[0].body.reason, "sha_mismatch");
    assert.equal((await child({ ...env, HSE_MONITOR_PROBE_URL: "http://untrusted.example.invalid/ready" })).code, 3);
    await writeFile(stateFile, "not json");
    const invalid = await child(env);
    assert.equal(invalid.code, 3);
    assert.equal(alerts.length, 1, "invalid durable incident state must fail closed");
    assert.doesNotMatch(invalid.stdout + invalid.stderr, new RegExp(TOKEN + "|" + ALERT_TOKEN));
  });
});

test("M3.12 monitor refuses concurrent runs for the same incident state", async () => {
  await fixture(async ({ env, stateFile, alerts }) => {
    await writeFile(stateFile + ".lock", "other run");
    assert.equal((await child(env)).code, 4);
    assert.equal(alerts.length, 0);
  });
});

test("M3.12 recovery notification retries after receiver rejection and stays idempotent", async () => {
  await fixture(async ({ env, alerts, stateFile, setProbeStatus, setWebhookStatus }) => {
    setProbeStatus(503);
    assert.equal((await child(env)).code, 2);
    setProbeStatus(200);
    setWebhookStatus(503);
    const failedRecovery = await child(env);
    assert.equal(failedRecovery.code, 3);
    assert.equal((await readFile(stateFile, "utf8")).includes('"phase":"recovering"'), true);
    const retryKey = alerts.at(-1).headers["x-idempotency-key"];
    setWebhookStatus(204);
    const retried = await child(env);
    assert.equal(retried.code, 0, retried.stderr);
    assert.equal(alerts.at(-1).headers["x-idempotency-key"], retryKey);
    assert.equal(alerts.at(-1).body.event, "incident_recovered");
    assert.equal((await readFile(stateFile, "utf8")).includes('"phase":"clear"'), true);
    const previous = alerts.length;
    assert.equal((await child(env)).code, 0);
    assert.equal(alerts.length, previous, "healthy repeated runs must not repeat recovery alerts");
  });
});

test("M3.12 genuinely concurrent monitors send only one incident and deny competing lock holder", async () => {
  await fixture(async ({ env, alerts, setProbeStatus, setWebhookDelay }) => {
    setProbeStatus(503);
    setWebhookDelay(500);
    const attempts = await Promise.all([child(env), child(env)]);
    assert.deepEqual(attempts.map(row => row.code).sort(), [2, 4]);
    assert.equal(alerts.length, 1, "two racing monitor processes must never both alert");
    assert.equal(alerts[0].body.event, "incident_open");
  });
});

test("M3.12 ambiguous failed OPEN still sends RECOVERED after the probe returns healthy", async () => {
  await fixture(async ({ env, alerts, stateFile, setProbeStatus, setWebhookStatus }) => {
    setProbeStatus(503);
    setWebhookStatus(502);
    assert.equal((await child(env)).code, 3);
    const pendingId = alerts[0].body.incidentId;
    setProbeStatus(200);
    setWebhookStatus(204);
    assert.equal((await child(env)).code, 0);
    assert.equal(alerts.length, 2, "receiver may have accepted OPEN before client failure; must send closure");
    assert.equal(alerts[1].body.event, "incident_recovered");
    assert.equal(alerts[1].body.incidentId, pendingId);
    assert.equal((await readFile(stateFile, "utf8")).includes('"phase":"clear"'), true);
  });
});

test("M3.12 a fresh outage after uncertain recovery opens a new incident", async () => {
  await fixture(async ({ env, alerts, setProbeStatus, setWebhookStatus }) => {
    setProbeStatus(503);
    assert.equal((await child(env)).code, 2);
    const firstId = alerts[0].body.incidentId;
    setProbeStatus(200);
    setWebhookStatus(502);
    assert.equal((await child(env)).code, 3);
    setWebhookStatus(204);
    setProbeStatus(503);
    assert.equal((await child(env)).code, 2);
    assert.equal(alerts.length, 3);
    assert.equal(alerts[2].body.event, "incident_open");
    assert.notEqual(alerts[2].body.incidentId, firstId);
  });
});
