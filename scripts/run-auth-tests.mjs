import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve(".auth-test-dist");
rmSync(outputDirectory, { recursive: true, force: true });

const compiler = spawnSync(
  process.execPath,
  [
    resolve("node_modules", "typescript", "bin", "tsc"),
    "-p",
    "tsconfig.auth-tests.json"
  ],
  { stdio: "inherit" }
);
if (compiler.status !== 0) {
  process.exit(compiler.status ?? 1);
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  resolve(outputDirectory, "package.json"),
  '{"type":"module"}\n',
  "utf8"
);

const tests = spawnSync(
  process.execPath,
  ["--test", resolve("tests", "auth", "auth-domain.test.mjs")],
  { stdio: "inherit" }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
