import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function source(path) {
  return readFile(resolve(path), "utf8");
}

test("registration routes expose create, verify and isolated sandbox surfaces", async () => {
  const [
    registerPage,
    verifyPage,
    submitRoute,
    resendRoute,
    sandboxPage,
    workerLoginPage,
    sharedLoginPage
  ] = await Promise.all([
    source("src/app/worker/register/page.tsx"),
    source("src/app/worker/register/verify/page.tsx"),
    source("src/app/worker/register/verify/submit/route.ts"),
    source("src/app/worker/register/verify/resend/route.ts"),
    source("src/app/worker/register/sandbox/page.tsx"),
    source("src/app/worker/login/page.tsx"),
    source("src/components/auth/role-login-page.tsx")
  ]);

  assert.match(registerPage, /readWorkerRegistrationToken/);
  assert.match(registerPage, /getWorkerRegistrationService/);
  assert.match(registerPage, /redirect\("\/worker\/register\/verify"\)/);
  assert.match(registerPage, /WorkerRegistrationForm/);

  assert.match(verifyPage, /WorkerVerificationForm/);
  assert.doesNotMatch(verifyPage, /Date\.now\(\)|initialNow/);
  assert.match(verifyPage, /const pendingStep/);
  assert.match(verifyPage, /state\.step === "pending_email"/);
  assert.match(verifyPage, /state\.step === "pending_phone"/);
  assert.match(verifyPage, /const isComplete = pendingStep === null/);
  assert.match(verifyPage, /challengeId=\{challengeId\}/);
  assert.match(verifyPage, /step=\{pendingStep\}/);
  assert.match(verifyPage, /Provisional registration reference/);
  assert.match(verifyPage, /not the permanent public Worker ID/);
  assert.match(verifyPage, /environment\.authSandboxEnabled/);

  assert.match(submitRoute, /export async function POST/);
  assert.match(submitRoute, /isSameOriginRegistrationPost/);
  assert.match(submitRoute, /readWorkerRegistrationChallengeBinding/);
  assert.match(submitRoute, /service\.verify/);
  assert.match(submitRoute, /303/);
  assert.match(resendRoute, /export async function POST/);
  assert.match(resendRoute, /service\.resend/);

  assert.match(sandboxPage, /if \(!environment\.authSandboxEnabled\)/);
  assert.match(sandboxPage, /notFound\(\)/);
  assert.match(sandboxPage, /RegistrationSandboxForm/);

  assert.match(workerLoginPage, /signInWorkerAccount/);
  assert.match(workerLoginPage, /role: "worker"/);
  assert.match(sharedLoginPage, /href="\/worker\/register"/);
});

test("registration actions recover through the opaque cookie and never create a session", async () => {
  const [actions, cookie, forms, requestSecurity] = await Promise.all([
    source("src/app/worker/register/actions.ts"),
    source("src/lib/auth/worker-registration-cookie.ts"),
    source("src/app/worker/register/registration-forms.tsx"),
    source("src/lib/http/registration-request.ts")
  ]);

  for (const marker of [
    "startWorkerRegistration",
    "cancelWorkerRegistration",
    "readSandboxDelivery",
    "writeWorkerRegistrationToken",
    "readWorkerRegistrationToken",
    "clearWorkerRegistrationToken"
  ]) {
    assert.match(actions, new RegExp(marker));
  }
  assert.doesNotMatch(actions, /verifyWorkerRegistration|resendWorkerRegistrationCode/);
  assert.match(actions, /redirect\("\/worker\/register\/verify"\)/);
  assert.match(actions, /password !== confirmPassword/);
  assert.match(actions, /registrationRequestFingerprint/);
  assert.match(requestSecurity, /x-forwarded-for/);
  assert.match(requestSecurity, /isSameOriginRegistrationPost/);
  assert.doesNotMatch(actions, /createWorkerSession|WORKER_SESSION_COOKIE|console\./);

  assert.match(cookie, /httpOnly: true/);
  assert.match(cookie, /sameSite: "lax"/);
  assert.match(cookie, /path: "\/worker\/register"/);
  assert.match(cookie, /__Secure-hse_worker_registration/);
  assert.doesNotMatch(cookie, /__Host-hse_worker_registration/);
  assert.match(cookie, /maxAge: 0/);
  assert.doesNotMatch(cookie, /cookieStore\.delete/);
  assert.doesNotMatch(cookie, /accountId|workerId|email|phone/);

  assert.match(forms, /useState<number \| null>\(null\)/);
  assert.match(forms, /const updateClock = \(\) => setNowTick\(Date\.now\(\)\)/);
  assert.ok(forms.indexOf("useEffect") < forms.indexOf("Date.now()"));
  assert.doesNotMatch(forms, /initialNow/);
  assert.match(forms, /resendSeconds === null/);
  assert.match(forms, /Checking resend time/);
  assert.match(forms, /autoComplete="one-time-code"/);
  assert.match(forms, /pattern="\[0-9\]\{6\}"/);
  assert.match(forms, /name="challengeId" type="hidden"/);
  assert.match(forms, /method="post"/);
  assert.match(forms, /Open sandbox inbox/);
  assert.match(forms, /Cancel this registration/);
  assert.doesNotMatch(forms, /localStorage|sessionStorage|document\.cookie/);
});

test("sandbox access remains separate from normal verification responses", async () => {
  const [service, actions, sandboxForm, sharedSandbox] = await Promise.all([
    source("src/lib/auth/worker-registration-service.ts"),
    source("src/app/worker/register/actions.ts"),
    source("src/app/worker/register/sandbox/sandbox-form.tsx"),
    source("src/lib/auth/auth-sandbox-service.ts")
  ]);

  assert.match(service, /readSandboxCode/);
  assert.match(service, /constantTimeStringEqual/);
  assert.match(service, /decryptSecret/);
  assert.match(service, /sandbox_denied/);
  assert.doesNotMatch(service, /console\./);
  assert.match(sharedSandbox, /readLatestAuthenticationSandboxCode/);
  assert.match(sharedSandbox, /constantTimeStringEqual/);
  assert.match(sharedSandbox, /decryptSecret/);

  const normalActionSection = actions.slice(
    actions.indexOf("export async function startWorkerRegistration"),
    actions.indexOf("export async function readSandboxDelivery")
  );
  assert.doesNotMatch(normalActionSection, /\.code\b|decryptSecret/);

  assert.match(sandboxForm, /type="password"/);
  assert.match(sandboxForm, /Development\/test sandbox only/);
  assert.match(sandboxForm, /state\.code/);
  assert.doesNotMatch(sandboxForm, /localStorage|sessionStorage/);
});

test("registration UI uses shared controls and reflows at mobile width", async () => {
  const [forms, sandboxForm, css] = await Promise.all([
    source("src/app/worker/register/registration-forms.tsx"),
    source("src/app/worker/register/sandbox/sandbox-form.tsx"),
    source("src/app/worker/register/registration.module.css")
  ]);

  for (const marker of ["<Button", "<Field", "<Input", "<Alert"]) {
    assert.match(forms, new RegExp(marker));
  }
  for (const marker of ["<Button", "<Field", "<Input", "<Select", "<Alert"]) {
    assert.match(sandboxForm, new RegExp(marker));
  }
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /overflow-wrap: anywhere/);
});
