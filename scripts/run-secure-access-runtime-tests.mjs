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

const outputDirectory = resolve(".secure-access-runtime-test-dist");
const sourceRoot = resolve("src", "lib");
rmSync(outputDirectory, { recursive: true, force: true });

const ENTRY_FILES = Object.freeze([
  "audit/audit-repository.ts",
  "secure-files/secure-file-repository.ts",
  "secure-files/secure-file-access-core.ts",
  "secure-files/secure-file-access-audit.ts"
]);
const RUNTIME_STUBS = new Set(["database/database.ts"]);

function runtimeSource(sourcePath) {
  return readFileSync(sourcePath, "utf8").replace(/^import "server-only";\r?\n\r?\n?/, "");
}

function normalizeRelativeSourcePath(sourcePath) {
  const value = relative(sourceRoot, sourcePath).replaceAll("\\", "/");
  if (value.startsWith("../") || value === "..") {
    throw new Error(`Secure access runtime dependency escaped src/lib: ${sourcePath}`);
  }
  return value;
}

function resolveRelativeImport(importerPath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(importerPath), specifier);
  const candidates = [base, `${base}.ts`, resolve(base, "index.ts")];
  for (const candidate of candidates) {
    if (!candidate.endsWith(".ts") || !existsSync(candidate)) continue;
    normalizeRelativeSourcePath(candidate);
    return candidate;
  }
  throw new Error(
    `Secure access runtime dependency could not be resolved: ${specifier} from ${importerPath}`
  );
}

function collectRuntimeSources(entryFiles) {
  const collected = new Set();

  function visit(relativePath) {
    if (RUNTIME_STUBS.has(relativePath) || collected.has(relativePath)) return;
    collected.add(relativePath);
    const sourcePath = resolve(sourceRoot, relativePath);
    const preprocessed = ts.preProcessFile(readFileSync(sourcePath, "utf8"), true, true);
    for (const imported of preprocessed.importedFiles) {
      const dependencyPath = resolveRelativeImport(sourcePath, imported.fileName);
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

const runtimeSources = collectRuntimeSources(ENTRY_FILES);
for (const file of runtimeSources) compileRuntimeModule(file);

mkdirSync(resolve(outputDirectory, "database"), { recursive: true });
writeFileSync(
  resolve(outputDirectory, "database", "database.js"),
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("Secure access runtime test must inject a database client."); };\n',
  "utf8"
);

const tests = spawnSync(
  process.execPath,
  [
    "--test",
    resolve("tests", "platform", "secure-file-access-runtime.test.mjs"),
    resolve("tests", "platform", "secure-file-access-audit.test.mjs"),
    resolve("tests", "platform", "secure-file-access-migration-stack.test.mjs"),
    resolve("tests", "platform", "secure-file-access-routes.test.mjs")
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HSE_SECURE_ACCESS_RUNTIME_DIST: outputDirectory
    }
  }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
