import { execFileSync, spawnSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function canResolve(ref) {
  try {
    git(["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

function baseRef() {
  const candidates = [
    process.env.HANDOFF_BASE_REF,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    "origin/main",
    "main",
    "HEAD^"
  ].filter(Boolean);
  return candidates.find(canResolve) ?? null;
}

function changedFiles(ref) {
  if (!ref) return [];
  const output = git(["diff", "--name-only", "--diff-filter=ACMRDTUXB", `${ref}...HEAD`]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function run(script) {
  console.log(`\n=== npm run ${script} ===`);
  const result = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const ref = baseRef();
const files = changedFiles(ref);

if (!ref || files.length === 0) {
  console.log("No reliable changed-area map was available; running the quick gate.");
  run("verify:quick");
  process.exit(0);
}

const has = (predicate) => files.some(predicate);
const engineeringSystemChanged = has(
  (file) =>
    file === "package.json" ||
    file === "package-lock.json" ||
    file.startsWith(".github/workflows/") ||
    file.startsWith("docs/engineering/") ||
    file.startsWith("scripts/report-manual-handoff") ||
    file.startsWith("scripts/run-engineering-gate") ||
    file.startsWith("scripts/verify-affected") ||
    file.startsWith("scripts/check-engineering") ||
    file.startsWith("scripts/lib/handoff-domain") ||
    file.startsWith("tests/engineering/")
);

if (engineeringSystemChanged) {
  console.log("Engineering gate or dependency files changed; affected verification safely escalates to the full gate.");
  run("verify:full");
  process.exit(0);
}

const commands = new Set(["typecheck", "lint"]);

if (has((file) => file.startsWith("src/lib/auth/") || file.startsWith("src/app/auth/") || file === "src/proxy.ts")) {
  commands.add("test:auth");
  commands.add("test:auth-completion");
  commands.add("test:portal-redirects");
}

if (has((file) => file.startsWith("src/lib/authorization/") || file.includes("authorization_tenant_isolation"))) {
  commands.add("check:authorization");
  commands.add("test:authorization");
  commands.add("test:authorization-platform");
}

if (has((file) => file.startsWith("database/") || file.startsWith("src/lib/database/") || file.startsWith("scripts/db-"))) {
  commands.add("test:integration");
  commands.add("test:runtime-db");
}

if (
  has(
    (file) =>
      file.startsWith("src/components/") ||
      file.startsWith("src/app/worker/") ||
      file.endsWith(".css")
  )
) {
  commands.add("check:design-system");
  commands.add("check:ux");
  commands.add("test:profile-overflow");
  commands.add("test:development");
}

if (commands.size === 2) {
  console.log("Changed files do not have a trustworthy focused mapping; running the full gate.");
  run("verify:full");
  process.exit(0);
}

console.log(`Affected verification base: ${ref}`);
console.log(`Changed files: ${files.length}`);
for (const command of commands) run(command);
