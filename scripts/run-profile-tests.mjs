import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve(".profile-test-dist");
rmSync(outputDirectory, { recursive: true, force: true });

const compiler = spawnSync(
  process.execPath,
  [resolve("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.profile-tests.json"],
  { stdio: "inherit" }
);
if (compiler.status !== 0) {
  process.exit(compiler.status ?? 1);
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "package.json"), '{"type":"module"}\n', "utf8");

const tests = spawnSync(
  process.execPath,
  ["--test", resolve("tests", "profile", "profile-domain.test.mjs")],
  { stdio: "inherit" }
);
process.exit(tests.status ?? 1);
