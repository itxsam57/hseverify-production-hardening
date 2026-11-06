import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { readFile, writeFile, readdir, readlink, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { login } from "../helpers/appeal-consumer-browser-journey.mjs";
import { stageBrowserArgs } from "../helpers/owned-staging-server.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";

if (!process.env.HSE_SOFTWARE_STAGE_CONFIG) {
  throw new Error("This staging drill requires HSE_SOFTWARE_STAGE_CONFIG for an isolated synthetic stage.");
}

function authenticatorCode(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  return String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

test("authenticated staging rollback preserves Company actions, cases, audit and private bytes", {
  timeout: 240000
}, async () => {
  const config = JSON.parse(await readFile(process.env.HSE_SOFTWARE_STAGE_CONFIG, "utf8"));
  assert.equal(config.syntheticOnly, true, "This drill requires a deliberately isolated synthetic stage");
  assert.equal(new URL(config.url).protocol, "https:");
  const environment = config.applicationEnvironment;
  assert.equal(environment.HSE_DEPLOYMENT_ID, "oracle-protected-staging");
  assert.equal(environment.PORT, String(config.appPort));
  assert.equal(new URL(environment.DATABASE_URL).hostname, "127.0.0.1");
  const accounts = JSON.parse(await readFile(config.accountsPath, "utf8"));
  const candidate = resolve(config.candidateBundle);
  const previous = resolve(config.previousBundle);
  assert.notEqual(candidate, previous);
  assert.notEqual(config.candidateSha, config.previousSha);
  assert.notEqual(
    createHash("sha256").update(await readFile(join(candidate, "server.js"))).digest("hex"),
    createHash("sha256").update(await readFile(join(previous, "server.js"))).digest("hex"),
    "The candidate and retained prior artifact must have different retained server payloads"
  );
  const stageRoot = await realpath(config.privateRoot);
  assert.ok(stageRoot.startsWith(resolve(config.projectRoot, "..") + "/hse-https-stage."));
  assert.equal(await realpath(environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT), join(stageRoot, "private-objects"));
  const logOffsets = Object.fromEntries(await Promise.all([config.appLog, config.postgresLog].map(async path => [path, (await readFile(path)).length])));
  const database = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl: environment.DATABASE_URL });
  const browser = await chromium.launch({ headless: true, args: stageBrowserArgs(config) });
  const context = await browser.newContext({
    httpCredentials: { username: config.user, password: config.password }
  });
  const workerContext = await browser.newContext({
    httpCredentials: { username: config.user, password: config.password }
  });
  const worker = await workerContext.newPage();
  let active = {pid: null, bundle: candidate, sha: config.candidateSha, startTime: null};
  let switching = false;
  let failure;
  let canceledPrefetchReads = 0;
  let canceledCommittedActions = 0;
  const inFlightRequests = new Set();
  const committedActions = new WeakSet();
  const controlledOutageRequests = new WeakSet();
  let activeChild;
  const errors = [];
  const failedRequests = [];
  const page = await context.newPage();
  const privatePath = join(environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT, "rollback-synthetic-evidence.bin");
  const privateBytes = Buffer.from("HSE controlled rollback evidence bytes");
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");

  async function waitForServer() {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:" + config.appPort + "/company/login");
        if (response.status === 200) return;
      } catch { /* The owned process is still starting. */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    throw new Error("Selected staging build did not start");
  }

  async function listenerInode() {
    const lines = (await readFile("/proc/net/tcp", "utf8")).trim().split("\n").slice(1);
    const listener = lines.map(line => line.trim().split(/\s+/)).find(fields =>
      Number.parseInt(fields[1].split(":")[1], 16) === Number(config.appPort) && fields[3] === "0A");
    if (!listener) return null;
    assert.equal(listener[1].split(":")[0], "0100007F", "The synthetic backend must remain loopback-only");
    return listener[9];
  }

  async function processIdentity(pid) {
    const status = await readFile("/proc/" + pid + "/stat", "utf8");
    const fields = status.slice(status.lastIndexOf(")") + 2).trim().split(/\s+/);
    return {
      pid, state: fields[0], startTime: fields[19],
      executable: await realpath("/proc/" + pid + "/exe"),
      cwd: await realpath("/proc/" + pid + "/cwd")
    };
  }

  async function verifyApp(app, requireListener = true) {
    const identity = await processIdentity(app.pid);
    if (app.startTime) assert.equal(identity.startTime, app.startTime, "Managed PID must not be reused");
    assert.equal(identity.executable, await realpath(process.execPath));
    const expectedDirectory = await realpath(app.bundle);
    assert.ok(identity.cwd === expectedDirectory ||
      (!requireListener && identity.cwd === await realpath(config.projectRoot)),
      "Owned child must remain in its declared stage directories");
    const entries = (await readFile("/proc/" + app.pid + "/environ", "utf8")).split("\0");
    assert.ok(entries.includes("HSE_RELEASE_SHA=" + app.sha), "Responding process must have the selected release identity");
    assert.ok(entries.includes("PORT=" + config.appPort));
    if (!requireListener) { app.startTime = identity.startTime; return identity; }
    const inode = await listenerInode();
    assert.ok(inode, "The selected app must own the listening socket");
    const links = await Promise.allSettled((await readdir("/proc/" + app.pid + "/fd"))
      .map(fd => readlink("/proc/" + app.pid + "/fd/" + fd)));
    assert.ok(links.some(link => link.status === "fulfilled" && link.value === "socket:[" + inode + "]"),
      "The selected PID must own the actual responding listener");
    app.startTime = identity.startTime;
    return identity;
  }

  async function stopApp() {
    if (!activeChild) return;
    if (activeChild.exitCode === null && activeChild.signalCode === null) {
      await verifyApp(active, false);
      await new Promise((resolveExit, rejectExit) => {
        const timer = setTimeout(() => rejectExit(new Error("Owned app did not exit")), 10000);
        activeChild.once("exit", () => { clearTimeout(timer); resolveExit(); });
        if (activeChild.exitCode !== null || activeChild.signalCode !== null) {
          clearTimeout(timer);
          resolveExit();
        } else activeChild.kill("SIGTERM");
      });
    }
    assert.equal(await listenerInode(), null, "The owned child must release its port before replacement");
    activeChild = null;
    active.pid = null;
  }

  async function deploy(bundle, sha, label) {
    switching = true;
    for (const request of inFlightRequests) {
      if (request.method() === "GET" || committedActions.has(request)) controlledOutageRequests.add(request);
    }
    await stopApp();
    const descriptor = openSync(config.appLog, "a", 0o600);
    let startupError;
    try {
      const entry = sha === config.candidateSha ? resolve(config.projectRoot, "scripts/start-production.mjs") : join(bundle, "server.js");
      activeChild = spawn(process.execPath, [entry], {
        cwd: config.projectRoot, env: { ...environment, HSE_RELEASE_SHA: sha },
        stdio: ["ignore", descriptor, descriptor]
      });
      activeChild.once("error", error => { startupError = error; });
    } finally { closeSync(descriptor); }
    active = { pid: activeChild.pid, bundle, sha, startTime: null };
    active.startTime = (await processIdentity(active.pid)).startTime;
    await waitForServer();
    assert.equal(Boolean(startupError), false, "The replacement must start successfully");
    await verifyApp(active);
    switching = false;
    console.log("ROLLBACK_BUILD", label, sha, "owned child, listener and bundle identity verified");
  }

  async function createSite(label) {
    await page.goto(config.url + "/company/organization", { waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, "/company/organization", "Existing session must survive the build switch");
    assert.doesNotMatch(await page.locator("main").innerText(), /could not complete this request/i);
    const name = "B00 " + label + " " + Date.now();
    await page.getByLabel("Unit type").selectOption("site");
    await page.getByLabel("Name").first().fill(name);
    await page.getByLabel("Formatted address").first().fill("1 Synthetic Rollback Road");
    await page.getByLabel("Phone").first().fill("+923001110001");
    await page.getByLabel("Website").first().fill("https://example.test");
    await page.getByLabel("Email").first().fill("rollback-site@example.test");
    const [response] = await Promise.all([
      page.waitForResponse(reply => reply.request().method() === "POST" &&
        Boolean(reply.request().headers()["next-action"])),
      page.getByRole("button", { name: "Create unit", exact: true }).click()
    ]);
    assert.ok(response.status() >= 200 && response.status() < 400, "The Company action must be acknowledged");
    await page.getByText("Site created.", { exact: true }).waitFor();
    const readyButton = page.getByRole("button", { name: "Create unit", exact: true });
    await readyButton.waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await readyButton.isEnabled(), true, "The form must settle and be usable again without reloading");
    const persistedView = await context.newPage();
    try {
      const loaded = await persistedView.goto(config.url + "/company/organization", { waitUntil: "networkidle" });
      assert.equal(loaded.status(), 200);
      await persistedView.getByRole("heading", { name, exact: true }).waitFor();
      assert.doesNotMatch(await persistedView.locator("main").innerText(), /could not complete this request/i);
    } finally { await persistedView.close(); }
    const result = await database.query("SELECT site_id,name,site_status FROM company_sites WHERE tenant_id=$1 AND name=$2", [accounts.company.tenantId, name]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].site_status, "active");
    committedActions.add(response.request());
    return result.rows[0];
  }

  try {
    await deploy(candidate, config.candidateSha, "candidate-initial");
    await writeFile(privatePath, privateBytes, { mode: 0o600 });
    await page.goto(config.url + "/company/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email address").fill(accounts.company.email);
    await page.getByLabel("Password").fill(accounts.company.password);
    await page.getByLabel("Authenticator code").fill(authenticatorCode(accounts.company.totpSecret));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/company/dashboard");
    function observePage(observedPage) {
      observedPage.on("pageerror", error => errors.push(error.message));
    observedPage.on("request", request => {
      inFlightRequests.add(request);
      if (switching && request.method() === "GET") controlledOutageRequests.add(request);
    });
    observedPage.on("requestfinished", request => inFlightRequests.delete(request));
    observedPage.on("response", response => {
      const expectedUnavailableRead = controlledOutageRequests.has(response.request()) &&
        response.request().method() === "GET" && [502, 503].includes(response.status());
      if (!expectedUnavailableRead && response.status() >= 400 && !new URL(response.url()).pathname.endsWith("/favicon.ico")) {
        errors.push("Unexpected HTTP " + response.status() + " " + new URL(response.url()).pathname);
      }
    });
    observedPage.on("requestfailed", request => {
      inFlightRequests.delete(request);
      failedRequests.push({ request, error: request.failure()?.errorText });
    });
    }
    observePage(page);
    context.on("page", observePage);
    const original = await createSite("candidate-before");
    const cases = (await database.query("SELECT * FROM assurance_cases ORDER BY case_id")).rows;
    assert.ok(cases.length > 0, "Rollback must preserve populated business cases");
    const ownedCase = cases.find(row => row.worker_account_id === accounts.worker.accountId);
    assert.ok(ownedCase, "The receiving Worker must own the populated case");
    await login(worker, config.url, accounts.worker, "worker");
    observePage(worker);
    const readWorkerCase = async () => {
      const response = await worker.goto(config.url + "/worker/assurance-cases/" + ownedCase.case_id);
      assert.equal(response.status(), 200);
      await worker.getByRole("heading", { name: "Assurance case", exact: true }).waitFor();
      const content = await worker.locator("article").innerText();
      assert.ok(content.includes(ownedCase.case_id));
      assert.ok(content.includes(ownedCase.next_action));
      return content;
    };
    const originalWorkerCase = await readWorkerCase();
    const timeline = (await database.query("SELECT * FROM assurance_case_timeline_events ORDER BY timeline_event_id")).rows;
    assert.ok(timeline.length > 0, "Rollback must preserve nonempty case history");
    const audit = (await database.query("SELECT * FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence", [original.site_id])).rows;
    assert.ok(audit.length > 0, "The original real Company action must have retained audit");

    for (const [label, bundle, sha] of [
      ["previous", previous, config.previousSha],
      ["candidate-return", candidate, config.candidateSha]
    ]) {
      await deploy(bundle, sha, label);
      await createSite(label);
      assert.deepEqual((await database.query("SELECT site_id,name,site_status FROM company_sites WHERE site_id=$1", [original.site_id])).rows[0], original);
      assert.deepEqual((await database.query("SELECT * FROM assurance_cases ORDER BY case_id")).rows, cases);
      assert.deepEqual((await database.query("SELECT * FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence", [original.site_id])).rows, audit);
      assert.deepEqual((await database.query("SELECT * FROM assurance_case_timeline_events ORDER BY timeline_event_id")).rows, timeline);
      assert.equal(hash(await readFile(privatePath)), hash(privateBytes));
      if (label === "candidate-return") assert.equal(await readWorkerCase(), originalWorkerCase);
    }
    for (const failed of failedRequests) {
      const request = failed.request;
      const headers = request.headers();
      const canceledPrefetch = request.method() === "GET" && failed.error === "net::ERR_ABORTED" &&
        headers["rsc"] === "1" && headers["next-router-prefetch"] === "1";
      const confirmedActionCancellation = request.method() === "POST" &&
        Boolean(headers["next-action"]) && failed.error === "net::ERR_ABORTED" && committedActions.has(request);
      const expectedOutageRead = controlledOutageRequests.has(request) && request.method() === "GET" &&
        ["net::ERR_ABORTED", "net::ERR_CONNECTION_RESET", "net::ERR_EMPTY_RESPONSE", "net::ERR_CONNECTION_CLOSED"].includes(failed.error);
      if (canceledPrefetch) canceledPrefetchReads += 1;
      else if (confirmedActionCancellation) canceledCommittedActions += 1;
      else if (!expectedOutageRead) errors.push("Unexpected request failure " + request.method() + " " +
        failed.error + " " + new URL(request.url()).pathname);
    }
    assert.deepEqual(errors, []);
    for (const name of [config.appLog, config.postgresLog]) {
      const output = (await readFile(name)).subarray(logOffsets[name]).toString("utf8");
      const invalid = /deadlock detected|⨯|unhandled rejection|uncaught exception|(?:^|\n)(?:Error|TypeError|ReferenceError|SyntaxError):|\b(?:ERROR|FATAL|PANIC):/i;
      assert.equal(invalid.test(output), false, "Unexpected server/database errors invalidate rollback health");
    }
    console.log("EXPECTED_CANCELED_RSC_PREFETCH_READS", canceledPrefetchReads);
    console.log("CANCELED_ACTIONS_WITH_SETTLED_UI_AND_CONFIRMED_PERSISTENCE", canceledCommittedActions);
    console.log("ROLLBACK_BUSINESS_PASS candidate -> previous -> candidate; authenticated Company actions and receiving Worker case retained with audit and private bytes");
  } catch (error) {
    failure = error;
  } finally {
    try {
      switching = true;
      await stopApp();
      console.log("OWNED_APP_TEARDOWN child exited and listener released");
    } catch (error) {
      failure = failure ? new AggregateError([failure, error], "Drill and owned app cleanup failed") : error;
    }
    await context.close();
    await browser.close();
    await database.close();
  }
  if (failure) throw failure;
});
