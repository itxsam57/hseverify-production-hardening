import { chromium } from "playwright";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3000";
const SANDBOX_KEY = process.env.HSE_AUTH_SANDBOX_ACCESS_KEY;
if (!SANDBOX_KEY) throw new Error("HSE_AUTH_SANDBOX_ACCESS_KEY is required.");

function summarizeSetCookie(value) {
  if (!value) {
    return {
      present: false,
      expectedName: false,
      expectedPath: false,
      httpOnly: false,
      sameSiteLax: false,
      secure: false
    };
  }
  return {
    present: true,
    expectedName:
      /(?:^|,|\s)hse_staff_enrollment=/.test(value) ||
      /(?:^|,|\s)__Secure-hse_staff_enrollment=/.test(value),
    expectedPath: /Path=\/staff\/invite/i.test(value),
    httpOnly: /HttpOnly/i.test(value),
    sameSiteLax: /SameSite=Lax/i.test(value),
    secure: /(?:^|;)\s*Secure(?:;|$)/i.test(value)
  };
}

function summarizeRequestCookie(value) {
  if (!value) return { present: false, names: [], expectedNamePresent: false };
  const names = value
    .split(";")
    .map((part) => part.trim().split("=", 1)[0] ?? "")
    .filter(Boolean);
  return {
    present: true,
    names,
    expectedNamePresent:
      names.includes("hse_staff_enrollment") ||
      names.includes("__Secure-hse_staff_enrollment")
  };
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const requestTrace = [];

page.on("request", (request) => {
  try {
    const requestUrl = new URL(request.url());
    if (
      requestUrl.pathname === "/staff/invite/accept" ||
      requestUrl.pathname === "/staff/invite/sandbox/diagnostic"
    ) {
      requestTrace.push({
        origin: requestUrl.origin,
        pathname: requestUrl.pathname,
        navigation: request.isNavigationRequest(),
        cookie: summarizeRequestCookie(request.headers()["cookie"] ?? null)
      });
    }
  } catch {
    // Diagnostic only.
  }
});

try {
  await page.goto(`${BASE_URL}/auth/sandbox/bootstrap-root`, {
    waitUntil: "domcontentloaded"
  });
  await page
    .getByLabel("First root email")
    .fill("root.cookie.diagnostic@example.test");
  await page
    .getByLabel("Authentication sandbox access key")
    .fill(SANDBOX_KEY);
  await page
    .getByRole("button", { name: "Create first root invitation" })
    .click();
  const result = page.locator(".security-key-card strong");
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const invitationPath = (await result.innerText()).trim();
  if (!invitationPath.startsWith("/staff/invite/")) {
    throw new Error("Diagnostic Root invitation path was not produced.");
  }

  let redirectCookieSummary = null;
  page.on("response", async (response) => {
    try {
      const responseUrl = new URL(response.url());
      if (responseUrl.pathname === invitationPath) {
        const location = await response.headerValue("location");
        redirectCookieSummary = {
          responseOrigin: responseUrl.origin,
          status: response.status(),
          locationOrigin: location ? safeOrigin(location) : null,
          locationPath: location ? new URL(location, response.url()).pathname : null,
          setCookie: summarizeSetCookie(await response.headerValue("set-cookie"))
        };
      }
    } catch {
      // Diagnostic only.
    }
  });

  await page.goto(`${BASE_URL}${invitationPath}`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForURL(/\/staff\/invite\/accept(?:\?|$)/, {
    timeout: 15_000
  });
  const firstBodyText = await page.locator("body").innerText();
  const cookies = (
    await context.cookies(`${BASE_URL}/staff/invite/accept`)
  ).map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    expiresInSeconds:
      cookie.expires > 0 ? Math.round(cookie.expires - Date.now() / 1000) : null
  }));

  const serverStateSameOrigin = await page.evaluate(async () => {
    const response = await fetch("/staff/invite/sandbox/diagnostic", {
      cache: "no-store",
      credentials: "same-origin"
    });
    return { status: response.status, body: await response.json() };
  });

  const serverStateInclude = await page.evaluate(async () => {
    const response = await fetch("/staff/invite/sandbox/diagnostic", {
      cache: "no-store",
      credentials: "include"
    });
    return { status: response.status, body: await response.json() };
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  const reloadedBodyText = await page.locator("body").innerText();
  const finalUrl = new URL(page.url());

  console.log(
    `STAFF_COOKIE_DIAGNOSTIC ${JSON.stringify({
      configuredOrigin: new URL(BASE_URL).origin,
      redirect: redirectCookieSummary,
      finalOrigin: finalUrl.origin,
      finalPath: finalUrl.pathname,
      firstProfileStepVisible: firstBodyText.includes("Create account credentials"),
      firstInvitationUnavailableVisible: firstBodyText.includes("Invitation unavailable"),
      reloadProfileStepVisible: reloadedBodyText.includes("Create account credentials"),
      reloadInvitationUnavailableVisible: reloadedBodyText.includes("Invitation unavailable"),
      cookies,
      requestTrace,
      serverStateSameOrigin,
      serverStateInclude
    })}`
  );
} finally {
  await context.close();
  await browser.close();
}
