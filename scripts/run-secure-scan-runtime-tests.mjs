import { spawnSync } from "node:child_process";
import {
  rmSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { compileRuntimeImportClosure } from "./lib/runtime-import-closure.mjs";

const outputDirectory = resolve(".secure-scan-runtime-test-dist");
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
  "reports/report-generation-finalizer.ts",
  "secure-files/secure-file-domain.ts",
  "secure-files/secure-file-scan-domain.ts",
  "secure-files/secure-file-scan-repository.ts",
  "database/database.ts"
]);

compileRuntimeImportClosure({
  sourceRoot, outputDirectory, entryFiles: SOURCE_FILES,
  sourceTransform: source => source.replace(/^import "server-only";\r?\n\r?\n?/, "")
});

writeFileSync(
  resolve(outputDirectory, "database", "database.js"),
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("Secure scan runtime test must inject a database client."); };\n',
  "utf8"
);

const tests = spawnSync(
  process.execPath,
  [
    "--test",
    resolve("tests", "platform", "secure-file-scan-runtime.test.mjs"),
    resolve("tests", "platform", "secure-file-scan-company-isolation.test.mjs"),
    resolve("tests", "platform", "secure-file-scan-result-semantics.test.mjs")
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HSE_SECURE_SCAN_RUNTIME_DIST: outputDirectory
    }
  }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
