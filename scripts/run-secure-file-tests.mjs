import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve(".secure-file-test-dist");
rmSync(outputDirectory, { recursive: true, force: true });

const compiler = spawnSync(
  process.execPath,
  [
    resolve("node_modules", "typescript", "bin", "tsc"),
    "-p",
    "tsconfig.secure-file-tests.json"
  ],
  { stdio: "inherit" }
);
if (compiler.status !== 0) {
  process.exit(compiler.status ?? 1);
}

const tests = spawnSync(
  process.execPath,
  [
    "--test",
    resolve("tests", "secure-files", "secure-file-domain.test.mjs"),
    resolve("tests", "secure-files", "private-object-storage.test.mjs")
  ],
  { stdio: "inherit" }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
