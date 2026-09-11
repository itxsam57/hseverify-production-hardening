import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const out = mkdtempSync(join(tmpdir(), "hse-assessment-attempt-runtime-"));
const root = resolve("src", "lib");
const alias = "@/lib/";
const entries = [
  "assessment-attempt/assessment-attempt-domain.ts",
  "assessment-attempt/assessment-attempt-draft-domain.ts",
  "assessment-attempt/assessment-attempt-repository.ts",
  "assessment-attempt/assessment-attempt-service.ts",
  "assessment-attempt/assessment-attempt-client-view.ts"
];
const stubs = new Set(["database/database.ts"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}
function relativeLib(path) {
  const value = relative(root, path).replaceAll("\\", "/");
  if (value.startsWith("../") || value === "..") {
    throw new Error(`M2.07 attempt runtime dependency escaped src/lib: ${path}`);
  }
  return value;
}
function resolveImport(importer, specifier) {
  let base;
  if (specifier.startsWith(".")) base = resolve(dirname(importer), specifier);
  else if (specifier.startsWith(alias)) base = resolve(root, specifier.slice(alias.length));
  else return null;
  for (const candidate of [base, `${base}.ts`, resolve(base, "index.ts")]) {
    if (candidate.endsWith(".ts") && existsSync(candidate)) {
      relativeLib(candidate);
      return candidate;
    }
  }
  throw new Error(`M2.07 attempt runtime dependency unresolved: ${specifier} from ${importer}`);
}
function outputSpecifier(importer, dependency) {
  let value = relative(dirname(importer), dependency)
    .replaceAll("\\", "/")
    .replace(/\.ts$/, "");
  if (!value.startsWith(".")) value = `./${value}`;
  return value;
}
function transformedSource(path) {
  let source = readFileSync(path, "utf8").replace(/^import "server-only";\r?\n\r?\n?/, "");
  for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
    const dependency = resolveImport(path, imported.fileName);
    if (!dependency) continue;
    const replacement = outputSpecifier(path, dependency);
    source = source
      .replaceAll(`"${imported.fileName}"`, `"${replacement}"`)
      .replaceAll(`'${imported.fileName}'`, `'${replacement}'`);
  }
  return source;
}
function collect() {
  const seen = new Set();
  function visit(relativePath) {
    if (stubs.has(relativePath) || seen.has(relativePath)) return;
    const path = resolve(root, relativePath);
    if (!existsSync(path)) fail(`M2.07 attempt runtime module missing: ${relativePath}`);
    seen.add(relativePath);
    for (const imported of ts.preProcessFile(readFileSync(path, "utf8"), true, true).importedFiles) {
      const dependency = resolveImport(path, imported.fileName);
      if (dependency) visit(relativeLib(dependency));
    }
  }
  entries.forEach(visit);
  return [...seen].sort();
}
function compile(relativePath) {
  const path = resolve(root, relativePath);
  const compiled = ts.transpileModule(transformedSource(path), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
      removeComments: false
    }
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors.length) {
    errors.forEach((diagnostic) =>
      console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
    );
    fail(`M2.07 attempt runtime compile failed for ${relativePath}`);
  }
  const destination = resolve(out, relativePath.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, compiled.outputText, "utf8");
}

collect().forEach(compile);
mkdirSync(resolve(out, "database"), { recursive: true });
writeFileSync(
  resolve(out, "database", "database.js"),
  '"use strict";\nObject.defineProperty(exports,"__esModule",{value:true});\nexports.getDatabaseClient=async function(){throw new Error("M2.07 attempt runtime injects its database client.");};\n',
  "utf8"
);

const requested = new Set(process.argv.slice(2));
const tests = [];
const m208 = requested.has("--m2-08");

function addTest(fileName) {
  const file = resolve("tests", "platform", fileName);
  if (!existsSync(file)) fail(`Assessment attempt test is missing: ${fileName}`);
  tests.push(file);
}

if (m208) {
  for (const fileName of [
    "assessment-attempt-m2-08-gate-contract.test.mjs",
    "assessment-attempt-m2-08-closure-workflow-contract.test.mjs",
    "assessment-attempt-draft-contract.test.mjs",
    "assessment-attempt-draft-rollback.test.mjs",
    "assessment-attempt-draft-runtime.test.mjs",
    "assessment-attempt-draft-concurrency-runtime.test.mjs",
    "assessment-attempt-draft-service-runtime.test.mjs",
    "assessment-attempt-draft-view-runtime.test.mjs",
    "assessment-attempt-draft-commit-runtime.test.mjs",
    "assessment-attempt-draft-action-boundary.test.mjs",
    "assessment-attempt-draft-ui-contract.test.mjs",
    "assessment-attempt-resume-runtime.test.mjs",
    "assessment-attempt-resume-ui-contract.test.mjs",
    "assessment-attempt-browser-contract.test.mjs",
    "assessment-attempt-ui-contract.test.mjs",
    "assessment-attempt-action-boundary.test.mjs"
  ]) {
    addTest(fileName);
  }
} else {
  if (requested.size === 0 || requested.has("--begin")) {
    addTest("assessment-attempt-begin-runtime.test.mjs");
  }
  if (requested.size === 0 || requested.has("--answers")) {
    addTest("assessment-attempt-answer-runtime.test.mjs");
  }
  if (requested.size === 0 || requested.has("--concurrency")) {
    addTest("assessment-attempt-concurrency-runtime.test.mjs");
  }
  if (requested.has("--drafts")) {
    addTest("assessment-attempt-draft-service-runtime.test.mjs");
  }
  if (requested.has("--draft-view")) {
    addTest("assessment-attempt-draft-view-runtime.test.mjs");
  }
  if (requested.has("--draft-commit")) {
    addTest("assessment-attempt-draft-commit-runtime.test.mjs");
  }
  if (requested.has("--resume")) {
    addTest("assessment-attempt-resume-runtime.test.mjs");
  }
}

if (tests.length === 0) fail("Assessment attempt runtime runner found no requested tests.");

const testArguments = ["--test", ...(m208 ? ["--test-concurrency=1"] : []), ...tests];
const result = spawnSync(process.execPath, testArguments, {
  stdio: "inherit",
  env: { ...process.env, HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST: out }
});
rmSync(out, { recursive: true, force: true });
process.exit(result.status ?? 1);
