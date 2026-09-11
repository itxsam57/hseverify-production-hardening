import assert from "node:assert/strict";
import { createServer } from "node:net";

import { runDevelopmentServer } from "./lib/development-server.mjs";

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a portal redirect smoke-test port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function expectedLocation(role) {
  return `/${role}/login?reason=session-required`;
}

async function assertSignedOutRedirect(baseUrl, input, output) {
  const protectedUrl = `${baseUrl}${input.pathname}`;
  const response = await fetch(protectedUrl, { redirect: "manual" });
  assert.equal(
    response.status,
    307,
    `${input.pathname} returned HTTP ${response.status} instead of the pre-render temporary redirect.\n${output()}`
  );

  const expected = expectedLocation(input.role);
  const location = response.headers.get("location");
  assert.equal(
    location,
    expected,
    `${input.pathname} redirected to ${location ?? "no location"}.\n${output()}`
  );

  const redirectBody = await response.text();
  assert.ok(
    redirectBody === "" || redirectBody === expected,
    `${input.pathname} missing-cookie redirect returned unexpected content: ${redirectBody}.\n${output()}`
  );
  assert.doesNotMatch(redirectBody, /<!DOCTYPE|<html|<main|Not available|requested record/i);

  const loginResponse = await fetch(new URL(location, baseUrl), {
    redirect: "manual"
  });
  assert.equal(
    loginResponse.status,
    200,
    `${input.role} login target returned HTTP ${loginResponse.status}.\n${output()}`
  );
  const body = await loginResponse.text();
  assert.match(body, /<main class="auth-page" id="main-content">/);
  assert.match(body, /Sign in to continue to this portal\./);
}

const PROTECTED_ENDPOINTS = [
  { pathname: "/worker/dashboard", role: "worker" },
  { pathname: "/worker/profile", role: "worker" },
  { pathname: "/worker/onboarding", role: "worker" },
  { pathname: "/company/dashboard", role: "company" },
  { pathname: "/company/tenant-scope", role: "company" },
  { pathname: "/assessor/dashboard", role: "assessor" },
  { pathname: "/verifier/dashboard", role: "verifier" },
  { pathname: "/admin/dashboard", role: "admin" },
  { pathname: "/admin/staff", role: "admin" },
  { pathname: "/root/dashboard", role: "root" },
  { pathname: "/root/staff", role: "root" }
];

const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const result = await runDevelopmentServer({
  args: ["--hostname", "127.0.0.1", "--port", String(port)],
  probeUrl: `${baseUrl}/worker/login`,
  probe: async ({ initialResponse, output }) => {
    assert.equal(initialResponse.status, 200, output());
    for (const input of PROTECTED_ENDPOINTS) {
      await assertSignedOutRedirect(baseUrl, input, output);
    }
  }
});

assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
console.log(
  "All accepted Worker, Company, Assessor, Verifier, Admin and Root protected endpoints received minimal pre-render signed-out redirects to their fixed-role login pages, and every login target rendered successfully."
);
