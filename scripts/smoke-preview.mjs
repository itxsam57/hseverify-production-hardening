import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { buildPortablePreviewBundle } from "./lib/preview-bundle.mjs";

const { bundleRoot: bundle, pgliteManifest } = await buildPortablePreviewBundle();
console.log(`Portable preview bundle created with PGlite at ${pgliteManifest}.`);

const port = 3107;
const sessionSecret =
  process.env.HSE_SESSION_SECRET ||
  "preview-smoke-session-secret-with-at-least-thirty-two-characters";
const server = spawn(process.execPath, [resolve(bundle, "server.js")], {
  cwd: bundle,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
  env: {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    HSE_APP_ENV: "test",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: "memory://",
    HSE_SESSION_SECRET: sessionSecret,
    HSE_AUTH_PEPPER:
      process.env.HSE_AUTH_PEPPER || `${sessionSecret}-registration-pepper`,
    HSE_ENABLE_AUTH_SANDBOX: "false",
    HSE_AUTH_SANDBOX_ACCESS_KEY: "",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  }
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

async function waitForStatus(pathname, expectedStatuses) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        redirect: "manual"
      });
      if (expectedStatuses.includes(response.status)) {
        return response;
      }
      lastError = new Error(`${pathname} returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }
  throw lastError ?? new Error(`Timed out waiting for ${pathname}.`);
}

async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill();
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null && server.signalCode === null) {
        server.kill("SIGKILL");
      }
      resolvePromise();
    }, 5_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

try {
  const root = await waitForStatus("/", [200]);
  const loginStatuses = [];
  for (const role of [
    "worker",
    "company",
    "assessor",
    "verifier",
    "admin",
    "root"
  ]) {
    const response = await waitForStatus(`/${role}/login`, [200]);
    loginStatuses.push(`${role}:${response.status}`);
  }

  const registration = await waitForStatus("/worker/register", [200]);
  const recovery = await waitForStatus("/auth/recover?portal=worker", [200]);
  const registrationSandbox = await waitForStatus(
    "/worker/register/sandbox",
    [404]
  );
  const rootBootstrapSandbox = await waitForStatus(
    "/auth/sandbox/bootstrap-root",
    [404]
  );

  for (const [pathname, expectedLogin] of [
    ["/worker/dashboard", "/worker/login"],
    ["/company/dashboard", "/company/login"],
    ["/company/tenant-scope", "/company/login"],
    ["/admin/dashboard", "/admin/login"],
    ["/root/dashboard", "/root/login"]
  ]) {
    const response = await waitForStatus(pathname, [303, 307, 308]);
    const location = response.headers.get("location");
    if (!location || new URL(location, `http://127.0.0.1:${port}`).pathname !== expectedLogin) {
      throw new Error(`${pathname} did not redirect to ${expectedLogin}.`);
    }
  }

  console.log(
    `Preview smoke passed: / ${root.status}; logins ${loginStatuses.join(", ")}; registration ${registration.status}; recovery ${recovery.status}; sandboxes closed ${registrationSandbox.status}/${rootBootstrapSandbox.status}; protected portals and Company tenant demonstration redirect.`
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stopServer();
  console.log("Preview smoke server stopped.");
}
