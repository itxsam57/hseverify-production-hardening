import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const base = new URL(process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3000");
if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.pathname !== "/") {
  throw new Error("Accessibility audit is restricted to a local, disposable HTTP test instance.");
}
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const output = "artifacts/independent-audit";
const roles = ["worker", "company", "verifier", "assessor", "admin", "root"];
const paths = ["/", ...roles.map(role => `/${role}/login`)];
const widths = [320, 390, 1280];
const pages = [];
let browser;

try {
  browser = await chromium.launch({ headless: true });
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      for (const route of paths) {
        const page = await context.newPage();
        const row = { route, width, status: "ERROR", violations: [], incompleteCount: 0 };
        try {
          const response = await page.goto(new URL(route, base).toString(), {
            waitUntil: "domcontentloaded", timeout: 20000
          });
          row.httpStatus = response?.status() ?? null;
          row.finalRoute = new URL(page.url()).pathname;
          if (!response || response.status() >= 400) {
            throw new Error(`Unexpected HTTP status ${row.httpStatus} at ${route}`);
          }
          const result = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          row.violations = result.violations.map(v => ({
            id: v.id, impact: v.impact, help: v.help,
            affectedNodes: v.nodes.length,
            targets: v.nodes.slice(0, 8).map(n => n.target.slice(0, 3))
          }));
          row.incompleteCount = result.incomplete.length;
          row.status = "SCANNED";
        } catch (error) {
          row.error = error instanceof Error ? error.message : String(error);
        } finally {
          pages.push(row);
          await page.close().catch(() => {});
        }
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close().catch(() => {});
  await mkdir(output, { recursive: true });
  const errorCount = pages.filter(p => p.status !== "SCANNED").length;
  const seriousOrCritical = pages.reduce((sum, p) => sum +
    p.violations.filter(v => ["serious", "critical"].includes(v.impact)).length, 0);
  const report = {
    exactSha: sha,
    environment: "isolated synthetic localhost browser (public and signed-out sign-in pages only)",
    scope: paths, widths,
    note: "Automated axe checks do not replace keyboard, screen reader, signed-in, or owner UAT.",
    scanned: pages.filter(p => p.status === "SCANNED").length,
    errors: errorCount, seriousOrCritical,
    pages
  };
  await writeFile(`${output}/axe.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ exactSha: sha, scanned: report.scanned, errors: errorCount, seriousOrCritical }, null, 2));
  if (errorCount || seriousOrCritical) process.exitCode = 1;
}
