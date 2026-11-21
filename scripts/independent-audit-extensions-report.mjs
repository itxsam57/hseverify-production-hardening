import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const output = "artifacts/independent-audit";
const read = async path => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return null; }
};
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const axe = await read(`${output}/axe.json`);
const zap = await read(`${output}/zap/zap.json`);
const ledger = await read(`${output}/exact-sha-218-summary.json`);
let commandLog = "";
try { commandLog = await readFile(`${output}/commands.tsv`, "utf8"); } catch {}
const commands = Object.fromEntries(commandLog.trim().split(/\r?\n/).filter(Boolean).map(line => {
  const [name, status] = line.split("\t"); return [name, Number(status)];
}));
const sites = !zap ? [] : Array.isArray(zap.site) ? zap.site : zap.site ? [zap.site] : [];
const alerts = sites.flatMap(site => Array.isArray(site.alerts) ? site.alerts : []).map(a => ({
  ruleId: a.alertRef || a.pluginid || null,
  name: a.alert || a.name || "Unknown ZAP alert",
  risk: a.riskdesc || "Unknown",
  riskCode: Number(a.riskcode ?? -1),
  instances: Array.isArray(a.instances) ? a.instances.length : 0
}));
const blockers = [];
if (!ledger || ledger.exactSha !== sha || ledger.frozenScenarioCount !== 218) blockers.push("Missing or inconsistent exact-SHA 218-scenario report");
if (!axe || axe.exactSha !== sha || !Array.isArray(axe.pages)) blockers.push("Axe scanner did not provide an exact-SHA report");
if (axe && axe.scanned !== 21) blockers.push(`Axe scanned ${axe.scanned}/21 required public and role sign-in page/viewport pairs`);
if (axe?.errors) blockers.push(`Axe could not scan ${axe.errors} pages`);
if (axe?.seriousOrCritical) blockers.push(`Axe reported ${axe.seriousOrCritical} serious/critical rule violations (not deduplicated)`);
if (!zap || !Array.isArray(zap.site) && !zap.site) blockers.push("ZAP passive scan report missing or invalid");
if (alerts.some(a => a.riskCode >= 3)) blockers.push("ZAP high-risk passive alerts require independent triage");
if (commands.passive_zap === undefined || commands.passive_zap > 1 || commands.passive_zap < 0)
  blockers.push("ZAP scan was not completed successfully or requires runner investigation");
if (commands.axe_accessibility === undefined) blockers.push("Axe execution status missing");
const report = {
  exactSha: sha, environment: "disposable localhost synthetic CI; no production scans",
  coverage: {
    axePages: axe?.scanned ?? 0,
    axeFailures: axe?.errors ?? null,
    axeSeriousCriticalOccurrences: axe?.seriousOrCritical ?? null,
    zapRulesTriggered: alerts.length,
    zapHighRiskAlerts: alerts.filter(a => a.riskCode >= 3).length,
    scenarioCount: ledger?.frozenScenarioCount ?? null,
    scenariosFullyVerifiedOnThisSha: ledger?.fullyVerified ?? null
  },
  commands: { axe: commands.axe_accessibility ?? null, zap: commands.passive_zap ?? null },
  findings: { zapAlerts: alerts, axePages: axe?.pages ?? null },
  blockers, assessment: blockers.length ? "QA_EXTENSION_REVIEW_REQUIRED" : "EXTENSION_BASELINE_NO_BLOCKERS_FOUND",
  releaseReady: false,
  note: "No unauthenticated passive scan, axe sample or previous scenario evidence can certify all six-role security or release readiness."
};
await mkdir(output, { recursive: true });
await writeFile(`${output}/QA-EXTENSIONS.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile(`${output}/QA-EXTENSIONS.md`,
  `# HSE Verify independent QA extensions\n\n- SHA: \`${sha}\`\n- Assessment: **${report.assessment}**\n- Axe scanned: ${report.coverage.axePages} signed-out pages/width combinations\n- Axe serious/critical occurrences: ${report.coverage.axeSeriousCriticalOccurrences ?? "NOT_RUN"}\n- ZAP passive alerts: ${report.coverage.zapRulesTriggered}; high risk: ${report.coverage.zapHighRiskAlerts}\n- Frozen scenarios fully certified on this SHA: ${report.coverage.scenariosFullyVerifiedOnThisSha ?? "UNKNOWN"}/218\n- Release certified: **NO**\n\n## Blockers for QA extension\n${blockers.length ? blockers.map(b => `- ${b}`).join("\n") : "- No extension scanner blockers; full release certification still separate."}\n\nZAP is passive, unauthenticated, localhost-only and does NOT prove a complete penetration test. Axe is a sample of public/sign-in pages, not full logged-in accessibility testing.\n`
);
console.log(JSON.stringify({ assessment: report.assessment, coverage: report.coverage, blockers }, null, 2));
if (process.argv.includes("--enforce") && blockers.length) process.exitCode = 1;
