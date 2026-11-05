import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {openSync,closeSync} from "node:fs";
import {readFile,readdir,readlink,realpath} from "node:fs/promises";
import {join} from "node:path";

export async function withOwnedStagingServer(config,run){
 const environment=config.applicationEnvironment;
 let activeChild;
 let active={pid:null,bundle:config.candidateBundle,sha:config.candidateSha,startTime:null};
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
    await stopApp();
    const descriptor = openSync(config.appLog, "a", 0o600);
    let startupError;
    try {
      activeChild = spawn(process.execPath, [join(bundle, "server.js")], {
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
    console.log("STAGE_BUILD", label, sha, "owned child, listener and bundle identity verified");
  }


 assert.equal(await listenerInode(),null,"Do not reuse or stop another service on the configured port");
 try{
   await deploy(config.candidateBundle,config.candidateSha,"candidate");
   return await run({restart:()=>deploy(config.candidateBundle,config.candidateSha,"restarted-candidate")});
 }finally{
   await stopApp();
   console.log("OWNED_STAGE_TEARDOWN child exited and listener released");
 }
}
