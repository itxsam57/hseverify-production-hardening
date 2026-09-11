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

const outputDirectory = resolve(".public-verification-runtime-test-dist");
const sourceRoot = resolve("src", "lib");
const LIB_ALIAS_PREFIX = "@/lib/";
rmSync(outputDirectory, { recursive: true, force: true });

const ENTRY_FILES = Object.freeze([
  "public-verification/public-verification-domain.ts",
  "public-verification/public-verification-capability.ts",
  "public-verification/public-verification-repository.ts",
  "public-verification/public-verification-request.ts",
  "public-verification/public-verification-service.ts",
  "public-verification/public-concern-file-service.ts"
]);
const RUNTIME_STUBS = new Set(["database/database.ts"]);

function normalizeRelativeSourcePath(sourcePath) {
  const value = relative(sourceRoot, sourcePath).replaceAll("\\", "/");
  if (value.startsWith("../") || value === "..") {
    throw new Error(`Public verification runtime dependency escaped src/lib: ${sourcePath}`);
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
    `Public verification runtime dependency could not be resolved: ${specifier} from ${importerPath}`
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
    const dependencyPath = resolveSourceImport(sourcePath, imported.fileName);
    if (!dependencyPath) continue;
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

try {
  for (const file of collectRuntimeSources(ENTRY_FILES)) {
    compileRuntimeModule(file);
  }

  mkdirSync(resolve(outputDirectory, "database"), { recursive: true });
  writeFileSync(
    resolve(outputDirectory, "database", "database.js"),
    '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("Public verification runtime test must inject a database client."); };\n',
    "utf8"
  );

  const tests = spawnSync(
    process.execPath,
    [
      "--test",
      resolve("tests", "platform", "public-verification-domain.test.mjs"),
      resolve("tests", "platform", "public-verification-migration.test.mjs"),
      resolve("tests", "platform", "public-verification-rate-limit.test.mjs"),
      resolve("tests", "platform", "public-verification-service.test.mjs"),
      resolve("tests", "platform", "public-verification-routes.test.mjs"),
      resolve("tests", "platform", "public-verification-concern.test.mjs"),
      resolve("tests", "platform", "public-verification-concern-evidence.test.mjs"),
      resolve("tests", "platform", "public-verification-concern-evidence-rollback.test.mjs")
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        HSE_PUBLIC_VERIFICATION_RUNTIME_DIST: outputDirectory
      }
    }
  );
  process.exitCode = tests.status ?? 1;
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
