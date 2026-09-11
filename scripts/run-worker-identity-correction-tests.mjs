import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const outputDirectory = resolve(".worker-identity-correction-runtime-test-dist");
const sourceRoot = resolve("src", "lib");
const LIB_ALIAS_PREFIX = "@/lib/";
rmSync(outputDirectory, { recursive: true, force: true });

const ENTRY_FILES = Object.freeze([
  "identity/worker-identity-domain.ts",
  "identity/worker-identity-repository.ts",
  "identity/worker-identity-draft-domain.ts",
  "identity/worker-identity-draft-repository.ts",
  "identity/worker-identity-evidence-domain.ts",
  "identity/worker-identity-evidence-repository.ts",
  "identity/worker-identity-correction-domain.ts",
  "identity/worker-identity-correction-repository.ts",
  "identity/worker-identity-correction-service.ts",
  "identity/worker-identity-service.ts",
  "identity/worker-identity-submission-coordinator.ts",
  "identity/worker-identity-submission-readiness-service.ts",
  "outbox/outbox-domain.ts",
  "outbox/outbox-repository.ts",
  "audit/audit-domain.ts",
  "audit/audit-repository.ts"
]);

const RUNTIME_STUBS = new Set(["database/database.ts"]);

const workspaceSource = readFileSync(
  resolve("src", "components", "worker", "identity-workspace.tsx"),
  "utf8"
);
if (/\b(?:encType|method)=/.test(workspaceSource)) {
  console.error(
    "Worker Identity Server Action forms must let React provide form method and encoding metadata."
  );
  process.exit(1);
}

const submissionCoordinatorSource = readFileSync(
  resolve("src", "lib", "identity", "worker-identity-submission-coordinator.ts"),
  "utf8"
);
for (const marker of [
  "database.transaction",
  "Promise.resolve(transaction)",
  "WorkerIdentitySubmissionReadinessService",
  "DatabaseWorkerIdentityRepository",
  "DatabaseWorkerIdentityCorrectionRepository",
  "submitInitial",
  "submitCorrection"
]) {
  if (!submissionCoordinatorSource.includes(marker)) {
    console.error(`Worker Identity atomic submission coordinator lost required contract: ${marker}`);
    process.exit(1);
  }
}

const readinessSource = readFileSync(
  resolve("src", "lib", "identity", "worker-identity-submission-readiness-service.ts"),
  "utf8"
);
for (const marker of [
  "CURRENT_SUBMISSION_CONTEXT_FOR_UPDATE_SQL",
  "FOR UPDATE OF identities, versions",
  "CURRENT_SUBMISSION_FILE_LOCK_SQL",
  "FOR UPDATE OF files"
]) {
  if (!readinessSource.includes(marker)) {
    console.error(`Worker Identity submission readiness lost required serialization guard: ${marker}`);
    process.exit(1);
  }
}
if (readinessSource.includes("getWorkerIdentitySubmissionReadinessService")) {
  console.error(
    "Worker Identity readiness must not expose an implicit standalone production singleton outside the atomic coordinator."
  );
  process.exit(1);
}

const identityServiceSource = readFileSync(
  resolve("src", "lib", "identity", "worker-identity-service.ts"),
  "utf8"
);
for (const marker of [
  "getWorkerIdentitySubmissionCoordinator",
  "submissionCoordinator.submitInitial"
]) {
  if (!identityServiceSource.includes(marker)) {
    console.error(`Initial Worker identity service lost atomic submission wiring: ${marker}`);
    process.exit(1);
  }
}

const correctionServiceSource = readFileSync(
  resolve("src", "lib", "identity", "worker-identity-correction-service.ts"),
  "utf8"
);
for (const marker of [
  "getWorkerIdentitySubmissionCoordinator",
  "submissionCoordinator.submitCorrection"
]) {
  if (!correctionServiceSource.includes(marker)) {
    console.error(`Worker identity correction service lost atomic submission wiring: ${marker}`);
    process.exit(1);
  }
}

function normalizeRelativeSourcePath(sourcePath) {
  const value = relative(sourceRoot, sourcePath).replaceAll("\\", "/");
  if (value.startsWith("../") || value === "..") {
    throw new Error(`Worker identity correction runtime dependency escaped src/lib: ${sourcePath}`);
  }
  return value;
}

function resolveSourceImport(importerPath, specifier) {
  let base;
  if (specifier.startsWith(".")) {
    base = resolve(dirname(importerPath), specifier);
  } else if (specifier.startsWith(LIB_ALIAS_PREFIX)) {
    base = resolve(sourceRoot, specifier.slice(LIB_ALIAS_PREFIX.length));
  } else {
    return null;
  }
  const candidates = [base, `${base}.ts`, resolve(base, "index.ts")];
  for (const candidate of candidates) {
    if (!candidate.endsWith(".ts") || !existsSync(candidate)) continue;
    normalizeRelativeSourcePath(candidate);
    return candidate;
  }
  throw new Error(
    `Worker identity correction runtime dependency could not be resolved: ${specifier} from ${importerPath}`
  );
}

function runtimeSpecifier(importerPath, dependencyPath) {
  let value = relative(dirname(importerPath), dependencyPath)
    .replaceAll("\\", "/")
    .replace(/\.ts$/, "");
  if (!value.startsWith(".")) value = `./${value}`;
  return value;
}

function runtimeSource(sourcePath) {
  let source = readFileSync(sourcePath, "utf8").replace(
    /^import "server-only";\r?\n\r?\n?/,
    ""
  );
  const preprocessed = ts.preProcessFile(source, true, true);
  for (const imported of preprocessed.importedFiles) {
    if (!imported.fileName.startsWith(LIB_ALIAS_PREFIX)) continue;
    const dependencyPath = resolveSourceImport(sourcePath, imported.fileName);
    if (!dependencyPath) {
      throw new Error(
        `Worker identity correction runtime alias could not be resolved: ${imported.fileName} from ${sourcePath}`
      );
    }
    const replacement = runtimeSpecifier(sourcePath, dependencyPath);
    source = source
      .replaceAll(`"${imported.fileName}"`, `"${replacement}"`)
      .replaceAll(`'${imported.fileName}'`, `'${replacement}'`);
  }
  return source;
}

function collectRuntimeSources(entryFiles) {
  const collected = new Set();
  function visit(relativePath) {
    if (RUNTIME_STUBS.has(relativePath) || collected.has(relativePath)) return;
    collected.add(relativePath);
    const sourcePath = resolve(sourceRoot, relativePath);
    const preprocessed = ts.preProcessFile(readFileSync(sourcePath, "utf8"), true, true);
    for (const imported of preprocessed.importedFiles) {
      const dependencyPath = resolveSourceImport(sourcePath, imported.fileName);
      if (!dependencyPath) continue;
      visit(normalizeRelativeSourcePath(dependencyPath));
    }
  }
  for (const entry of entryFiles) visit(entry);
  return [...collected].sort();
}

function compileRuntimeModule(relativePath) {
  const sourcePath = resolve(sourceRoot, relativePath);
  const compiled = ts.transpileModule(runtimeSource(sourcePath), {
    fileName: sourcePath,
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
  if (errors.length > 0) {
    for (const diagnostic of errors) {
      console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    }
    process.exit(1);
  }
  const destination = resolve(outputDirectory, relativePath.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, compiled.outputText, "utf8");
}

for (const file of collectRuntimeSources(ENTRY_FILES)) compileRuntimeModule(file);

mkdirSync(resolve(outputDirectory, "database"), { recursive: true });
writeFileSync(
  resolve(outputDirectory, "database", "database.js"),
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("Worker identity correction runtime test must inject a database client."); };\n',
  "utf8"
);

const tests = spawnSync(
  process.execPath,
  [
    "--test",
    resolve("tests", "identity", "worker-identity-correction-domain.test.mjs"),
    resolve("tests", "platform", "worker-identity-initial-contact-binding.test.mjs"),
    resolve("tests", "platform", "worker-identity-submission-readiness.test.mjs"),
    resolve("tests", "platform", "worker-identity-corrections.test.mjs"),
    resolve("tests", "platform", "worker-identity-correction-migration-stack.test.mjs")
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HSE_WORKER_IDENTITY_CORRECTION_RUNTIME_DIST: outputDirectory
    }
  }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
