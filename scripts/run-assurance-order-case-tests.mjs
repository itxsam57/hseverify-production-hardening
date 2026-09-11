import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const tests = [
  "assurance-order-case-domain.test.mjs",
  "assurance-order-case-migration.test.mjs",
  "assurance-order-case-service.test.mjs",
  "assurance-order-case-routes.test.mjs"
].map((name) => resolve("tests", "platform", name));

const staticResult = spawnSync(process.execPath, ["--test", ...tests], {
  stdio: "inherit",
  env: { ...process.env }
});
if ((staticResult.status ?? 1) !== 0) {
  process.exitCode = staticResult.status ?? 1;
} else {
  const runtimeResult = spawnSync(process.execPath, [resolve("scripts", "run-assurance-order-case-runtime-tests.mjs")], {
    stdio: "inherit",
    env: { ...process.env }
  });
  process.exitCode = runtimeResult.status ?? 1;
}
