import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve(".secure-access-test-dist");
rmSync(outputDirectory, { recursive: true, force: true });

const compiler = spawnSync(
  process.execPath,
  [
    resolve("node_modules", "typescript", "bin", "tsc"),
    "-p",
    "tsconfig.secure-access-tests.json"
  ],
  { stdio: "inherit" }
);
if (compiler.status !== 0) process.exit(compiler.status ?? 1);

// Production modules deliberately import `server-only`. Standalone Node tests
// do not run with Next's react-server condition, so remove only the emitted
// marker import from isolated test copies after strict TypeScript has compiled
// the real sources. Production source remains unchanged.
for (const filename of [
  "secure-file-access-domain.js",
  "secure-file-access-core.js",
  "secure-file-access-request.js"
]) {
  const compiledPath = resolve(outputDirectory, "secure-files", filename);
  const compiledSource = readFileSync(compiledPath, "utf8");
  const testSource = compiledSource.replace(
    /require\(["']server-only["']\);\r?\n/,
    ""
  );
  if (testSource === compiledSource) {
    throw new Error(`Secure access test harness could not isolate server-only from ${filename}.`);
  }
  writeFileSync(compiledPath, testSource, "utf8");
}

const tests = spawnSync(
  process.execPath,
  [
    "--test",
    resolve("tests", "secure-files", "secure-file-access-domain.test.mjs"),
    resolve("tests", "secure-files", "secure-file-access-core.test.mjs"),
    resolve("tests", "secure-files", "secure-file-access-request.test.mjs")
  ],
  { stdio: "inherit" }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
