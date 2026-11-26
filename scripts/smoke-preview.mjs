import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { buildPortablePreviewBundle } from "./lib/preview-bundle.mjs";

const { bundleRoot: bundle, pgliteManifest } = await buildPortablePreviewBundle();
console.log(`Portable preview bundle assembled (bundled PGlite dependency at ${pgliteManifest}; preview runtime uses PostgreSQL).`);

const port = 3107;
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8", timeout: 10_000
}).trim();
if (!/^[a-f0-9]{40}$/.test(sourceSha)) {
  throw new Error("Portable preview smoke requires an exact Git source commit.");
}
// Next standalone forces NODE_ENV=production. Running it in HSE_APP_ENV=test
// with PGlite would violate the intentional production safety checks. This
// is only a public-route/denied-route offline smoke, NOT a database workflow,
// so the PostgreSQL URL points at a deliberately unavailable localhost port.
const isolatedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    !key.startsWith("HSE_") && key !== "DATABASE_URL"
  )
);
const server = spawn(process.execPath, [resolve(bundle, "server.js")], {
  cwd: bundle,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
  env: {
    ...isolatedEnvironment,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    HSE_APP_ENV: "preview",
    HSE_DATABASE_DRIVER: "postgres",
    DATABASE_URL: "postgresql://offline-smoke:offline-smoke@127.0.0.1:9/no_db",
    HSE_RELEASE_SHA: sourceSha,
    HSE_SESSION_SECRET: randomBytes(32).toString("hex"),
    HSE_AUTH_PEPPER: randomBytes(32).toString("hex"),
    HSE_ENABLE_AUTH_SANDBOX: "false",
    HSE_AUTH_SANDBOX_ACCESS_KEY: "",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false",
    NEXT_TELEMETRY_DISABLED: "1"
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
    `Offline preview public/redirect smoke passed (no database attached): / ${root.status}; logins ${loginStatuses.join(", ")}; registration ${registration.status}; recovery ${recovery.status}; sandboxes closed ${registrationSandbox.status}/${rootBootstrapSandbox.status}; protected portals and Company tenant demonstration redirect.`
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stopServer();
  console.log("Preview smoke server stopped.");
}
