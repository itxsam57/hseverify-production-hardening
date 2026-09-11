import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const outputDirectory = resolve(".secure-upload-runtime-test-dist");
const sourceRoot = resolve("src", "lib");
rmSync(outputDirectory, { recursive: true, force: true });

const SOURCE_FILES = Object.freeze([
  "auth/auth-domain.ts",
  "authorization/authorization-domain.ts",
  "authorization/authorization-context-domain.ts",
  "authorization/tenant-scoped-resource-domain.ts",
  "authorization/tenant-scoped-command-guard.ts",
  "audit/audit-domain.ts",
  "audit/audit-repository.ts",
  "secure-files/secure-file-domain.ts",
  "secure-files/secure-file-upload-domain.ts",
  "secure-files/secure-file-upload-repository.ts",
  "database/database.ts"
]);

function runtimeSource(sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  return source.replace(/^import "server-only";\r?\n\r?\n?/, "");
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
      console.error(
        `Runtime transpile failed for ${relative(sourceRoot, sourcePath)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`
      );
    }
    process.exit(1);
  }
  const destination = resolve(
    outputDirectory,
    relativePath.replace(/\.ts$/, ".js")
  );
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, compiled.outputText, "utf8");
}

for (const sourceFile of SOURCE_FILES) compileRuntimeModule(sourceFile);

const databaseStub = resolve(outputDirectory, "database", "database.js");
writeFileSync(
  databaseStub,
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("Secure upload runtime test must inject a database client."); };\n',
  "utf8"
);

const tests = spawnSync(
  process.execPath,
  ["--test", resolve("tests", "platform", "secure-file-upload-runtime.test.mjs")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HSE_SECURE_UPLOAD_RUNTIME_DIST: outputDirectory
    }
  }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
