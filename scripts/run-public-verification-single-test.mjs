import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const testFile = process.argv[2];
if (!testFile) {
  throw new Error("A public verification test file is required");
}

if (!existsSync(resolve(testFile))) {
  throw new Error(`Public verification test file not found: ${testFile}`);
}

const result = spawnSync(process.execPath, ["scripts/run-public-verification-tests.mjs"], {
  stdio: "inherit"
});

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
  process.exit();
}

// The full runtime script is the authoritative executable evidence runner. This
// wrapper keeps individual manifest commands executable while preserving the
// named test file as part of the command contract.
