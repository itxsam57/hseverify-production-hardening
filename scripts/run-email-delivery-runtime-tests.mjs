import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const outputDirectory = resolve(".email-delivery-runtime-test-dist");
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
  "email-delivery/email-delivery-domain.ts",
  "email-delivery/email-delivery-adapter.ts",
  "email-delivery/email-delivery-repository.ts",
  "email-delivery/email-delivery-handler.ts",
  "config/environment.ts",
  "config/server-environment.ts",
  "database/database.ts"
]);

function runtimeSource(sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  // `server-only` is a Next.js build marker, not product logic and not a direct
  // dependency in this repository. The real project typecheck/build validate the
  // marker. The temporary execution copy removes only this exact side-effect import.
  return source.replace(/^import "server-only";\r?\n\r?\n?/, "");
}

function compileRuntimeModule(relativePath) {
  const sourcePath = resolve(sourceRoot, relativePath);
  const source = runtimeSource(sourcePath);
  const compiled = ts.transpileModule(source, {
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
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n"
      );
      console.error(
        `Runtime transpile failed for ${relative(sourceRoot, sourcePath)}: ${message}`
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

for (const sourceFile of SOURCE_FILES) {
  compileRuntimeModule(sourceFile);
}

// The runtime test injects the real PGlite script database client explicitly.
// Replace only the default compiled factories so test execution never opens a
// hidden second database or depends on application-only environment bootstrap.
const databaseStub = resolve(outputDirectory, "database", "database.js");
writeFileSync(
  databaseStub,
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("Runtime test must inject a database client."); };\n',
  "utf8"
);

const environmentStub = resolve(
  outputDirectory,
  "config",
  "server-environment.js"
);
writeFileSync(
  environmentStub,
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getServerEnvironment = function getServerEnvironment() { throw new Error("Runtime test must inject the local/test adapter environment."); };\n',
  "utf8"
);

const tests = spawnSync(
  process.execPath,
  ["--test", resolve("tests", "platform", "email-delivery-runtime.test.mjs")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HSE_EMAIL_DELIVERY_RUNTIME_DIST: outputDirectory
    }
  }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
