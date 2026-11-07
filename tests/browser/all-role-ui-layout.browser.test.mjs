import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const ROUTES = {
  worker: [
    "/worker/dashboard",
    "/worker/profile",
    "/worker/identity",
    "/worker/evidence",
    "/worker/passport",
    "/worker/available-assessments",
    "/worker/company-access",
    "/worker/share-links",
    "/worker/privacy",
    "/worker/notifications",
    "/account/sessions"
  ],
  company: [
    "/company/dashboard",
    "/company/settings/profile",
    "/company/organization",
    "/company/team",
    "/company/invitations",
    "/company/assurance-orders",
    "/company/assurance-orders/new",
    "/company/action-centre",
    "/company/reports",
    "/company/settings/policy",
    "/company/billing",
    "/company/notifications",
    "/company/tenant-scope",
    "/account/sessions"
  ],
  verifier: [
    "/verifier/dashboard",
    "/verifier/reviews",
    "/verifier/reviews/scoring",
    "/verifier/notifications",
    "/account/sessions"
  ],
  assessor: [
    "/assessor/dashboard",
    "/assessor/interviews",
    "/assessor/notifications",
    "/account/sessions"
  ],
  admin: [
    "/admin/dashboard",
    "/admin/company-verifications",
    "/admin/frameworks",
    "/admin/question-bank",
    "/admin/assessment-blueprints",
    "/admin/assessment-catalogue",
    "/admin/decisions",
    "/admin/certifications",
    "/admin/operations",
    "/admin/staff",
    "/admin/notifications",
    "/account/sessions"
  ],
  root: [
    "/root/dashboard",
    "/root/staff",
    "/root/notifications",
    "/account/sessions"
  ]
};

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("No port."));
        else resolve(address.port);
      });
    });
  });
}

async function login(page, baseUrl, role, credential) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== `/${role}/login`, { timeout: 20_000 });
}

async function layoutProblems(page, mobile) {
  return page.evaluate(({ mobile }) => {
    const visible = (element) => {
      const closedDetails = element.closest("details:not([open])");
      if (closedDetails && element !== closedDetails.querySelector(":scope > summary")) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const selector = [
      "button",
      "summary",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "a.button",
      "a.ds-button",
      ".nav-link"
    ].join(",");
    const controls = [...document.querySelectorAll(selector)].filter(visible);
    const rects = controls.map((element, index) => {
      const rect = element.getBoundingClientRect();
      return {
        index,
        element,
        tag: element.tagName,
        text: (element.getAttribute("aria-label") || element.textContent || element.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 100),
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      };
    });
    const clipped = rects
      .filter((item) => ["BUTTON", "A", "SUMMARY"].includes(item.tag))
      .filter((item) => item.scrollWidth > item.clientWidth + 3 || item.scrollHeight > item.clientHeight + 3)
      .map(({ text, tag, scrollWidth, clientWidth, scrollHeight, clientHeight }) => ({
        text, tag, scrollWidth, clientWidth, scrollHeight, clientHeight
      }));
    const tooSmall = rects
      .filter((item) => {
        if (item.tag === "INPUT" && item.element.getAttribute("type") === "checkbox") return false;
        if (item.tag === "INPUT" && item.element.getAttribute("type") === "radio") return false;
        const minimum = mobile ? 40 : 34;
        return item.w < minimum || item.h < minimum;
      })
      .map(({ text, tag, w, h }) => ({ text, tag, w: Math.round(w), h: Math.round(h) }));
    const offscreen = rects
      .filter((item) => item.x < -2 || item.right > document.documentElement.clientWidth + 2)
      .map(({ text, tag, x, right }) => ({ text, tag, x: Math.round(x), right: Math.round(right) }));
    const overlaps = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
        const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
        const area = x * y;
        const smaller = Math.min(a.w * a.h, b.w * b.h);
        if (smaller > 0 && area / smaller > 0.35) {
          overlaps.push({ a: a.text, b: b.text, ratio: Math.round((area / smaller) * 100) });
        }
      }
    }
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped,
      tooSmall,
      offscreen,
      overlaps: overlaps.slice(0, 20)
    };
  }, { mobile });
}

test("all role portal pages keep usable proportions, navigation and notification controls on desktop and mobile", { timeout: 300_000 }, async () => {
  const root = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-role-ui-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const outputDirectory = join(root, "artifacts", "all-role-ui-layout");
  await mkdir(join(outputDirectory, "desktop"), { recursive: true });
  await mkdir(join(outputDirectory, "mobile"), { recursive: true });

  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "all-role-ui-layout-browser",
    HSE_SESSION_SECRET: "all-role-ui-layout-session-secret-2026-000000000",
    HSE_AUTH_PEPPER: "all-role-ui-layout-auth-pepper-2026-00000000000",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs"]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: root,
        env: environment,
        encoding: "utf8"
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const credentials = JSON.parse(await readFile(process.env.HSE_AUDIT_CREDENTIALS_PATH ?? "/tmp/independent-audit-credentials.json", "utf8"));

    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/worker/login`,
      projectRoot: root,
      environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          for (const [role, routes] of Object.entries(ROUTES)) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            const page = await context.newPage();
            await login(page, baseUrl, role, credentials[role]);
            await page.locator("details.profile-menu > summary").click();
            await page.getByRole("link", { name: "Language: English", exact: true }).click();
            await page.waitForURL("**#interface-language");
            const language = page.getByRole("region", { name: "Interface language", exact: true });
            await language.getByText("English", { exact: true }).waitFor({ state: "visible" });
            await language.getByText("This release is available in English.", { exact: true }).waitFor();
            assert.equal(await page.locator("html").getAttribute("lang"), "en");


            for (const route of routes) {
              const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
              assert(response && response.status() < 500, `${role} ${route} HTTP ${response?.status()}`);

              const desktop = await layoutProblems(page, false);
              assert(desktop.documentOverflow <= 1, `${role} ${route} desktop overflow: ${JSON.stringify(desktop)}`);
              assert.deepEqual(desktop.offscreen, [], `${role} ${route} desktop offscreen controls`);
              assert.deepEqual(desktop.overlaps, [], `${role} ${route} desktop overlapping controls: ${JSON.stringify(desktop.overlaps)}`);
              assert.deepEqual(desktop.clipped, [], `${role} ${route} desktop clipped controls: ${JSON.stringify(desktop.clipped)}`);
              await page.screenshot({
                path: join(outputDirectory, "desktop", `${role}--${route.replace(/^\//, "").replaceAll("/", "__")}.png`),
                fullPage: true
              });

              await page.setViewportSize({ width: 390, height: 844 });
              await page.waitForTimeout(80);
              const mobile = await layoutProblems(page, true);
              assert(mobile.documentOverflow <= 1, `${role} ${route} mobile overflow: ${JSON.stringify(mobile)}`);
              assert.deepEqual(mobile.offscreen, [], `${role} ${route} mobile offscreen controls: ${JSON.stringify(mobile.offscreen)}`);
              assert.deepEqual(mobile.overlaps, [], `${role} ${route} mobile overlapping controls: ${JSON.stringify(mobile.overlaps)}`);
              assert.deepEqual(mobile.clipped, [], `${role} ${route} mobile clipped controls: ${JSON.stringify(mobile.clipped)}`);
              await page.screenshot({
                path: join(outputDirectory, "mobile", `${role}--${route.replace(/^\//, "").replaceAll("/", "__")}.png`),
                fullPage: true
              });
              await page.setViewportSize({ width: 1440, height: 1000 });
            }

            await page.goto(`${baseUrl}/${role}/dashboard`, { waitUntil: "networkidle" });
            const notificationSummary = page.locator("details.notification-menu > summary");
            await notificationSummary.waitFor({ state: "visible" });
            await notificationSummary.click();
            await page.locator("details.notification-menu[open] .menu-panel").waitFor({ state: "visible" });
            await page.locator("details.notification-menu").evaluate((element) => element.removeAttribute("open"));

            await page.setViewportSize({ width: 390, height: 844 });
            await notificationSummary.waitFor({ state: "visible" });
            const mobileBox = await notificationSummary.boundingBox();
            assert(mobileBox && mobileBox.width >= 40 && mobileBox.height >= 40, `${role} mobile notification control is undersized`);
            await notificationSummary.click();
            const mobileNotificationPanel = page.locator("details.notification-menu[open] .menu-panel");
            await mobileNotificationPanel.waitFor({ state: "visible" });
            const panelBox = await mobileNotificationPanel.boundingBox();
            assert(panelBox && panelBox.y >= mobileBox.y + mobileBox.height, `${role} mobile notification panel covers its toggle`);
            await notificationSummary.click();
            await mobileNotificationPanel.waitFor({ state: "hidden" });

            const mobileNav = page.locator("details.mobile-nav-menu > summary");
            await mobileNav.waitFor({ state: "visible" });
            await mobileNav.click();
            await page.locator("details.mobile-nav-menu[open] .mobile-nav-panel").waitFor({ state: "visible" });
            await context.close();
          }
        } finally {
          await browser.close();
        }
      }
    });

    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
