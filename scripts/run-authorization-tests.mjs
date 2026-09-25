import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const outputDirectory = mkdtempSync(join(tmpdir(), "hse-authorization-test-dist-"));

try {
  const compiler = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "-p",
      "tsconfig.authorization-tests.json",
      "--outDir",
      outputDirectory
    ],
    { stdio: "inherit" }
  );
  if (compiler.status !== 0) {
    process.exitCode = compiler.status ?? 1;
  } else {
    const tests = spawnSync(
      process.execPath,
      [
        "--test",
        resolve("tests", "authorization", "authorization-domain.test.mjs"),
        resolve("tests", "authorization", "authorization-context-domain.test.mjs"),
        resolve("tests", "authorization", "authorization-cross-role-matrix.test.mjs"),
        resolve("tests", "authorization", "tenant-scoped-resource-domain.test.mjs")
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          HSE_AUTHORIZATION_TEST_DIST: outputDirectory
        }
      }
    );
    process.exitCode = tests.status ?? 1;
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
