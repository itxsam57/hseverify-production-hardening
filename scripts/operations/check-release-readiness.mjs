#!/usr/bin/env node
// Operator-run monitoring: local evidence is never proof of real on-call delivery.
import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

function validatedUrl(raw, allowLoopback) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("INVALID_MONITOR_URL"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const permitted = url.protocol === "https:" || (allowLoopback && url.protocol === "http:" && loopback);
  if (!permitted || url.username || url.password || url.hash || url.search) {
    throw new Error("UNSAFE_MONITOR_URL");
  }
  return url.href;
}
function config() {
  const env = process.env;
  const allowLoopback = env.HSE_MONITOR_ALLOW_LOOPBACK_HTTP === "true";
  const probeToken = env.HSE_MONITOR_PROBE_TOKEN ?? "";
  const webhookToken = env.HSE_MONITOR_WEBHOOK_TOKEN ?? "";
  const expectedSha = env.HSE_MONITOR_EXPECTED_SHA ?? "";
  const stateFile = env.HSE_MONITOR_STATE_FILE ?? "";
  if (
    probeToken.length < 32 || webhookToken.length < 32 ||
    !/^[a-f0-9]{40}$/.test(expectedSha) || !isAbsolute(stateFile)
  ) throw new Error("MONITOR_NOT_CONFIGURED");
  return {
    probeUrl: validatedUrl(env.HSE_MONITOR_PROBE_URL, allowLoopback),
    webhookUrl: validatedUrl(env.HSE_MONITOR_WEBHOOK_URL, allowLoopback),
    probeToken, webhookToken, expectedSha, stateFile
  };
}
function checkState(state) {
  if (!state || !["clear", "opening", "open", "recovering"].includes(state.phase)) {
    throw new Error("INVALID_MONITOR_STATE");
  }
  if (state.phase !== "clear" && !/^[0-9a-f-]{36}$/.test(state.incidentId ?? "")) {
    throw new Error("INVALID_MONITOR_STATE");
  }
  return state;
}
async function loadState(file) {
  try { return checkState(JSON.parse(await readFile(file, "utf8"))); }
  catch (error) {
    if (error?.code === "ENOENT") return { phase: "clear" };
    throw new Error("INVALID_MONITOR_STATE");
  }
}
async function saveState(file, state) {
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(checkState(state)), { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
async function probe(configured) {
  try {
    const response = await fetch(configured.probeUrl, {
      method: "GET", redirect: "error",
      headers: { Authorization: "Bearer " + configured.probeToken },
      signal: AbortSignal.timeout(7000),
      cache: "no-store"
    });
    if (response.status !== 200) return { healthy: false, reason: "http_failure" };
    const body = await response.json();
    if (body?.status !== "ready" || body?.scope !== "database_connection_only") return { healthy: false, reason: "not_ready" };
    if (body?.releaseSha !== configured.expectedSha) return { healthy: false, reason: "sha_mismatch" };
    return { healthy: true };
  } catch {
    return { healthy: false, reason: "probe_unavailable" };
  }
}
async function sendAlert(configured, incident, event, reason) {
  const body = {
    schema: "hse-readiness-monitor-v1",
    event, reason, incidentId: incident.incidentId,
    expectedSha: configured.expectedSha, observedAt: new Date().toISOString()
  };
  try {
    const response = await fetch(configured.webhookUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(7000),
      headers: {
        Authorization: "Bearer " + configured.webhookToken,
        "Content-Type": "application/json",
        "X-Idempotency-Key": "hse-" + incident.incidentId + "-" + event
      },
      body: JSON.stringify(body)
    });
    if (response.status < 200 || response.status > 299) throw new Error("RECEIVER_REJECTED");
  } catch {
    throw new Error("ALERT_DELIVERY_UNCONFIRMED");
  }
}
async function run() {
  const configured = config();
  await mkdir(dirname(configured.stateFile), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(configured.stateFile + ".lock", "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") return { code: 4, result: "MONITOR_ALREADY_RUNNING" };
    throw new Error("MONITOR_LOCK_UNAVAILABLE");
  }
  try {
    let state = await loadState(configured.stateFile);
    const result = await probe(configured);
    if (result.healthy) {
      if (state.phase === "open" || state.phase === "opening" || state.phase === "recovering") {
        const incident = { ...state, phase: "recovering" };
        await saveState(configured.stateFile, incident);
        await sendAlert(configured, incident, "incident_recovered", "healthy_again");
        await saveState(configured.stateFile, { phase: "clear" });
      }
      return { code: 0, result: "HEALTHY" };
    }
    if (state.phase === "recovering") {
      // A recovery may already have reached the receiver before its acknowledgement failed.
      // A new outage therefore needs a new incident, not the old deduplicated OPEN key.
      state = { phase: "opening", incidentId: randomUUID() };
      await saveState(configured.stateFile, state);
    }
    if (state.phase === "clear") {
      state = { phase: "opening", incidentId: randomUUID() };
      await saveState(configured.stateFile, state);
    }
    if (state.phase === "opening") {
      await sendAlert(configured, state, "incident_open", result.reason);
      await saveState(configured.stateFile, { ...state, phase: "open" });
    }
    return { code: 2, result: "UNHEALTHY", reason: result.reason };
  } finally {
    await lock.close();
    await rm(configured.stateFile + ".lock", { force: true });
  }
}
try {
  const result = await run();
  process.stdout.write(JSON.stringify({ status: result.result, reason: result.reason ?? null }) + "\n");
  process.exitCode = result.code;
} catch (error) {
  const code = ["MONITOR_NOT_CONFIGURED", "INVALID_MONITOR_URL", "UNSAFE_MONITOR_URL",
    "INVALID_MONITOR_STATE", "MONITOR_LOCK_UNAVAILABLE", "ALERT_DELIVERY_UNCONFIRMED"
  ].includes(error?.message) ? error.message : "MONITOR_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 3;
}
