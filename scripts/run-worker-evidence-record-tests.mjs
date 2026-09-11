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

const outputDirectory = resolve(".worker-evidence-runtime-test-dist");
const sourceRoot = resolve("src", "lib");
const LIB_ALIAS_PREFIX = "@/lib/";
const ENTRY_FILES = Object.freeze([
  "worker-evidence/worker-evidence-domain.ts",
  "worker-evidence/worker-evidence-repository.ts",
  "worker-evidence/worker-evidence-service.ts",
  "worker-evidence/worker-evidence-attachment-service.ts"
]);
const RUNTIME_STUBS = new Set(["database/database.ts"]);

rmSync(outputDirectory, { recursive: true, force: true });

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeRelativeSourcePath(sourcePath) {
  const value = relative(sourceRoot, sourcePath).replaceAll("\\", "/");
  if (value.startsWith("../") || value === "..") {
    throw new Error(`M1.11 runtime dependency escaped src/lib: ${sourcePath}`);
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

  for (const candidate of [base, `${base}.ts`, resolve(base, "index.ts")]) {
    if (!candidate.endsWith(".ts") || !existsSync(candidate)) continue;
    normalizeRelativeSourcePath(candidate);
    return candidate;
  }
  throw new Error(
    `M1.11 runtime dependency could not be resolved: ${specifier} from ${importerPath}`
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
      throw new Error(`Unresolved M1.11 runtime alias: ${imported.fileName}`);
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
    const sourcePath = resolve(sourceRoot, relativePath);
    if (!existsSync(sourcePath)) {
      fail(`M1.11 RED: required runtime production module is missing: ${relativePath}`);
    }
    collected.add(relativePath);
    const preprocessed = ts.preProcessFile(
      readFileSync(sourcePath, "utf8"),
      true,
      true
    );
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
    fail(`M1.11 runtime compile failed for ${relativePath}`);
  }
  const destination = resolve(
    outputDirectory,
    relativePath.replace(/\.ts$/, ".js")
  );
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, compiled.outputText, "utf8");
}

for (const file of collectRuntimeSources(ENTRY_FILES)) {
  compileRuntimeModule(file);
}

mkdirSync(resolve(outputDirectory, "database"), { recursive: true });
writeFileSync(
  resolve(outputDirectory, "database", "database.js"),
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("M1.11 runtime test must inject a database client."); };\n',
  "utf8"
);

const result = spawnSync(
  process.execPath,
  [
    "--test",
    resolve("tests", "platform", "worker-evidence-records.test.mjs"),
    resolve("tests", "platform", "worker-evidence-lifecycle.test.mjs"),
    resolve("tests", "platform", "worker-evidence-attachments.test.mjs"),
    resolve("tests", "platform", "worker-evidence-async-scan.test.mjs"),
    resolve("tests", "platform", "worker-evidence-file-candidate-migration.test.mjs"),
    resolve("tests", "platform", "worker-evidence-file-candidate-retry.test.mjs"),
    resolve("tests", "platform", "worker-evidence-dashboard-navigation.test.mjs"),
    resolve("tests", "platform", "worker-evidence-leaving-letter.test.mjs"),
    resolve("tests", "platform", "worker-qualification-flow.test.mjs"),
    resolve("tests", "platform", "worker-evidence-migration-stack.test.mjs"),
    resolve("tests", "platform", "worker-evidence-migration-guards.test.mjs")
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HSE_WORKER_EVIDENCE_RUNTIME_DIST: outputDirectory
    }
  }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(result.status ?? 1);
