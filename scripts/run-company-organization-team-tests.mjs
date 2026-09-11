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

const outputDirectory = resolve(".company-organization-team-runtime-test-dist");
const sourceRoot = resolve("src", "lib");
const LIB_ALIAS_PREFIX = "@/lib/";
rmSync(outputDirectory, { recursive: true, force: true });

const ENTRY_FILES = Object.freeze([
  "company/company-organization-domain.ts",
  "company/company-organization-repository.ts",
  "company/company-team-service.ts",
  "audit/audit-domain.ts",
  "audit/audit-repository.ts",
  "auth/auth-domain.ts",
  "auth/auth-repository.ts",
  "auth/auth-access-repository.ts",
  "authorization/authorization-context-domain.ts",
  "authorization/authorization-domain.ts",
  "authorization/tenant-scoped-resource-domain.ts",
  "authorization/tenant-scoped-command-guard.ts"
]);
const RUNTIME_STUBS = new Set(["database/database.ts"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeRelativeSourcePath(sourcePath) {
  const value = relative(sourceRoot, sourcePath).replaceAll("\\", "/");
  if (value.startsWith("../") || value === "..") {
    throw new Error(`M1.09 runtime dependency escaped src/lib: ${sourcePath}`);
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
  throw new Error(`M1.09 runtime dependency could not be resolved: ${specifier} from ${importerPath}`);
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
    if (!dependencyPath) throw new Error(`Unresolved M1.09 runtime alias: ${imported.fileName}`);
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
    fail(`M1.09 runtime compile failed for ${relativePath}`);
  }
  const destination = resolve(outputDirectory, relativePath.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, compiled.outputText, "utf8");
}

for (const file of collectRuntimeSources(ENTRY_FILES)) compileRuntimeModule(file);

mkdirSync(resolve(outputDirectory, "database"), { recursive: true });
writeFileSync(
  resolve(outputDirectory, "database", "database.js"),
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("M1.09 runtime test must inject a database client."); };\n',
  "utf8"
);

const tests = spawnSync(
  process.execPath,
  [
    "--test",
    resolve("tests", "platform", "company-organization-team.test.mjs"),
    resolve("tests", "platform", "company-organization-team-migration-stack.test.mjs")
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HSE_COMPANY_ORGANIZATION_TEAM_RUNTIME_DIST: outputDirectory
    }
  }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
