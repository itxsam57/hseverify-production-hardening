import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "artifacts", "independent-audit");
const findings = [];
const metrics = {};

function add(severity, category, file, line, message, evidence = null) {
  findings.push({ severity, category, file, line, message, evidence });
}

async function walk(relative) {
  const start = path.join(ROOT, relative);
  const result = [];
  async function visit(abs, rel) {
    let entries;
    try { entries = await readdir(abs, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (["node_modules", ".next", ".git", "artifacts"].includes(entry.name)) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = path.posix.join(rel.replaceAll("\\", "/"), entry.name);
      if (entry.isDirectory()) await visit(childAbs, childRel);
      else result.push(childRel);
    }
  }
  await visit(start, relative);
  return result;
}

function lineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function deriveRoute(file) {
  if (file === "src/app/page.tsx") return "/";
  const normalized = file.replaceAll("\\", "/");
  const parts = normalized.replace(/^src\/app\//, "").replace(/\/page\.tsx$/, "").split("/")
    .filter((part) => part && !/^\(.+\)$/.test(part) && !part.startsWith("@"));
  return "/" + parts.join("/");
}

await mkdir(OUT, { recursive: true });
const all = [
  ...await walk("src"),
  ...await walk("database"),
  ...await walk("scripts"),
  ...await walk("tests"),
  "package.json"
];
const uniqueAll = [...new Set(all)];
const prod = uniqueAll.filter((file) => file.startsWith("src/") && /\.(?:ts|tsx|js|mjs)$/.test(file));
const textFiles = uniqueAll.filter((file) => /\.(?:ts|tsx|js|mjs|css|sql|json|md|yml|yaml)$/.test(file));
metrics.totalFiles = uniqueAll.length;
metrics.productionSourceFiles = prod.length;
metrics.testFiles = uniqueAll.filter((file) => file.startsWith("tests/")).length;
metrics.scriptFiles = uniqueAll.filter((file) => file.startsWith("scripts/")).length;

const contents = new Map();
for (const file of textFiles) {
  try { contents.set(file, await readFile(path.join(ROOT, file), "utf8")); }
  catch {}
}

// Route inventory is discovered from the codebase, not from milestone records.
const pages = uniqueAll.filter((file) => /^src\/app\/.+\/page\.tsx$/.test(file) || file === "src/app/page.tsx");
const routes = pages.map((file) => ({ file, route: deriveRoute(file), dynamic: file.includes("[") }));
metrics.pageRoutes = routes.length;
metrics.staticPageRoutes = routes.filter((item) => !item.dynamic).length;
metrics.dynamicPageRoutes = routes.filter((item) => item.dynamic).length;
const routeNames = new Map();
for (const item of routes) {
  const list = routeNames.get(item.route) ?? [];
  list.push(item.file);
  routeNames.set(item.route, list);
}
for (const [route, files] of routeNames) {
  if (files.length > 1) add("high", "routing", files.join(", "), 1, `Multiple page files resolve to route ${route}.`);
}

// Migration pairing/order checks.
const migrations = uniqueAll.filter((file) => file.startsWith("database/migrations/") && /\.sql$/.test(file));
const migrationMap = new Map();
for (const file of migrations) {
  const name = path.posix.basename(file);
  const match = /^(\d{4})_(.+)\.(up|down)\.sql$/.exec(name);
  if (!match) {
    add("medium", "migration", file, 1, "Migration filename does not follow ####_name.up|down.sql.");
    continue;
  }
  const key = `${match[1]}_${match[2]}`;
  const value = migrationMap.get(key) ?? new Set();
  value.add(match[3]);
  migrationMap.set(key, value);
}
for (const [key, directions] of migrationMap) {
  if (!directions.has("up") || !directions.has("down")) add("high", "migration", `database/migrations/${key}`, 1, "Migration is missing a matching up/down pair.");
}
metrics.migrationPairs = migrationMap.size;

const patterns = [
  ["medium", "unfinished-marker", /\b(?:TODO|FIXME|HACK|XXX)\b/g, "Unfinished-work marker in production source."],
  ["high", "debugger", /\bdebugger\s*;/g, "Debugger statement in production source."],
  ["medium", "console-debug", /\bconsole\.(?:log|debug)\s*\(/g, "Console debug output in production source."],
  ["high", "type-suppression", /@ts-(?:ignore|nocheck)/g, "TypeScript safety suppression in production source."],
  ["medium", "lint-suppression", /eslint-disable(?:-next-line|-line)?/g, "ESLint suppression in production source; review whether justified."],
  ["critical", "unsafe-eval", /\beval\s*\(|new\s+Function\s*\(/g, "Dynamic code execution sink in production source."],
  ["high", "unsafe-html", /dangerouslySetInnerHTML|\.innerHTML\s*=/g, "Raw HTML injection surface in production source."],
  ["low", "temporary-copy", /\b(?:dummy|mock|placeholder|temporary|demo-only|test-only)\b/gi, "Potential temporary/demo behavior in production source; auditor review required."],
  ["medium", "explicit-any", /:\s*any\b|<any>|as\s+any\b/g, "Explicit any weakens compile-time contract."],
  ["medium", "insecure-http", /["']http:\/\/(?!127\.0\.0\.1|localhost)[^"']+["']/g, "Non-local HTTP URL literal in production source."]
];

// Only strong secret material belongs in the client-boundary blocker class. Timestamps,
// account IDs, form IDs and other ordinary browser-facing identifiers are not secrets by name.
const strongClientSensitive = /\b(?:passwordHash|tokenHash|csrfTokenHash|encryptedSecret|ipAddressHash)\b/g;
const directSecretAssignment = /\b(?:passwordHash|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']{12,}["']/gi;
const upperCredentialAssignment = /\b([A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY))\b\s*=\s*["']([^"']{12,})["']/g;

for (const file of prod) {
  const content = contents.get(file) ?? "";
  for (const [severity, category, regex, message] of patterns) {
    regex.lastIndex = 0;
    for (const match of content.matchAll(regex)) add(severity, category, file, lineAt(content, match.index ?? 0), message, match[0]);
  }

  for (const match of content.matchAll(directSecretAssignment)) {
    add("high", "hardcoded-secret", file, lineAt(content, match.index ?? 0), "Potential hard-coded credential/secret literal in production source.", match[0]);
  }
  for (const match of content.matchAll(upperCredentialAssignment)) {
    const identifier = match[1];
    const evidence = match[0];
    const intentionalSynthetic = /^(?:DUMMY|TEST|FAKE|PLACEHOLDER)_/.test(identifier) || /timing-only/i.test(evidence);
    add(
      intentionalSynthetic ? "info" : "high",
      intentionalSynthetic ? "synthetic-credential-literal" : "hardcoded-secret",
      file,
      lineAt(content, match.index ?? 0),
      intentionalSynthetic
        ? "Synthetic credential-like literal is intentionally named as non-production material; retain only if its use remains security-safe."
        : "Potential hard-coded credential/secret literal in production source.",
      evidence
    );
  }

  if (/^[\s\S]*?["']use client["'];/.test(content)) {
    for (const match of content.matchAll(strongClientSensitive)) {
      add("high", "client-boundary", file, lineAt(content, match.index ?? 0), "Secret-bearing field name appears in a Client Component. Verify it is not serialized across the Server→Client boundary.", match[0]);
    }
  }
  const size = Buffer.byteLength(content, "utf8");
  const lines = content.split("\n").length;
  if (lines > 900) add("medium", "complexity", file, 1, `Large production source file (${lines} lines) increases audit and regression risk.`);
  else if (lines > 650) add("low", "complexity", file, 1, `Large production source file (${lines} lines); consider responsibility split when next modified.`);
  if (size === 0) add("medium", "empty-source", file, 1, "Empty production source file.");
}

// Exact duplicate production files are strong dead/extra-code candidates.
const duplicateMap = new Map();
for (const file of prod) {
  const content = contents.get(file) ?? "";
  const hash = createHash("sha256").update(content).digest("hex");
  const list = duplicateMap.get(hash) ?? [];
  list.push(file);
  duplicateMap.set(hash, list);
}
for (const files of duplicateMap.values()) {
  if (files.length > 1) add("low", "duplicate-code", files.join(", "), 1, "Files are byte-for-byte identical; verify they are not redundant dead code.");
}

// Conservative dead-export candidate scan. Search all audited repository text, not only src/.
// Even a single textual occurrence remains a candidate only: framework bindings and future
// contract boundaries still require manual verification before any deletion.
const repositoryCorpus = [...contents.values()].join("\n");
const exportRegex = /export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
for (const file of prod) {
  const content = contents.get(file) ?? "";
  for (const match of content.matchAll(exportRegex)) {
    const name = match[1];
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const occurrences = repositoryCorpus.match(new RegExp(`\\b${escaped}\\b`, "g"))?.length ?? 0;
    if (occurrences <= 1) {
      add(
        "info",
        "dead-export-candidate",
        file,
        lineAt(content, match.index ?? 0),
        `Export ${name} has no other textual reference in audited repository text. This is a cleanup candidate only; confirm runtime/framework/milestone use before deletion.`,
        { occurrences }
      );
    }
  }
}

// Basic secret material scan across repository text.
const secretLike = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|sk_(?:live|prod)_[A-Za-z0-9_-]{16,}/g;
for (const [file, content] of contents) {
  for (const match of content.matchAll(secretLike)) add("critical", "secret-material", file, lineAt(content, match.index ?? 0), "Potential real secret/private key committed to repository.", match[0].slice(0, 18));
}

// Package-level health clues independent of milestone assertions. package.json is explicitly
// part of the scanner corpus so this check cannot manufacture a missing-tooling finding.
const pkgText = contents.get("package.json");
if (!pkgText) {
  add("critical", "tooling", "package.json", 1, "package.json could not be read by the independent auditor.");
} else {
  const pkg = JSON.parse(pkgText);
  metrics.runtimeDependencies = Object.keys(pkg.dependencies ?? {}).length;
  metrics.devDependencies = Object.keys(pkg.devDependencies ?? {}).length;
  if (!pkg.scripts?.build || !pkg.scripts?.typecheck || !pkg.scripts?.lint) add("high", "tooling", "package.json", 1, "Build/typecheck/lint commands are not all present.");
}

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || a.file.localeCompare(b.file) || a.line - b.line);
const counts = Object.fromEntries(["critical", "high", "medium", "low", "info"].map((severity) => [severity, findings.filter((f) => f.severity === severity).length]));
const report = { auditedAt: new Date().toISOString(), basis: "fresh repository scan; no milestone assertions used", metrics, counts, routes, findings };
await writeFile(path.join(OUT, "static.json"), JSON.stringify(report, null, 2));
let md = `# Independent static audit\n\nBasis: fresh repository scan; no milestone assertions used.\n\n## Metrics\n\n${Object.entries(metrics).map(([k,v]) => `- ${k}: ${v}`).join("\n")}\n\n## Finding counts\n\n${Object.entries(counts).map(([k,v]) => `- ${k}: ${v}`).join("\n")}\n\n## Findings\n\n`;
md += findings.length ? findings.map((f, i) => `${i + 1}. **${f.severity.toUpperCase()} — ${f.category}** — \`${f.file}:${f.line}\` — ${f.message}${f.evidence ? ` — evidence: \`${String(typeof f.evidence === "string" ? f.evidence : JSON.stringify(f.evidence)).replaceAll("`", "'")}\`` : ""}`).join("\n") : "No findings.\n";
await writeFile(path.join(OUT, "static.md"), md + "\n");
console.log(JSON.stringify({ metrics, counts }, null, 2));
