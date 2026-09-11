import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const outputDirectory = resolve(".secure-scan-handler-runtime-test-dist");
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
  "outbox/outbox-domain.ts",
  "outbox/outbox-repository.ts",
  "secure-files/secure-file-domain.ts",
  "secure-files/secure-file-scan-domain.ts",
  "secure-files/secure-file-scan-repository.ts",
  "secure-files/secure-file-scan-handler-core.ts",
  "secure-files/malware-scanner-core.ts",
  "secure-files/private-object-storage-core.ts",
  "database/database.ts"
]);

function runtimeSource(sourcePath) {
  return readFileSync(sourcePath, "utf8").replace(/^import "server-only";\r?\n\r?\n?/, "");
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

for (const file of SOURCE_FILES) compileRuntimeModule(file);

writeFileSync(
  resolve(outputDirectory, "database", "database.js"),
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("Secure scan handler runtime test must inject a database client."); };\n',
  "utf8"
);

const tests = spawnSync(
  process.execPath,
  ["--test", resolve("tests", "platform", "secure-file-scan-handler-runtime.test.mjs")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HSE_SECURE_SCAN_HANDLER_RUNTIME_DIST: outputDirectory
    }
  }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
