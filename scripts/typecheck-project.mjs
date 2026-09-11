import { spawn } from "node:child_process";
import { resolve } from "node:path";

import {
  assertProjectConfigurationUnchanged,
  cleanGeneratedConfiguration,
  cleanNextMode,
  prepareNextMode,
  snapshotProjectConfiguration,
  verifyNextGeneratedFiles
} from "./lib/next-build-system.mjs";

async function run(command, args, environment) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...environment,
      NEXT_TELEMETRY_DISABLED: "1"
    },
    stdio: "inherit",
    windowsHide: true
  });

  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveResult({ code, signal }));
  });

  if (result.signal) {
    throw new Error(`${args.join(" ")} stopped by signal ${result.signal}.`);
  }
  if (result.code !== 0) {
    const error = new Error(`${args.join(" ")} exited with code ${result.code}.`);
    error.exitCode = result.code ?? 1;
    throw error;
  }
}

const projectRoot = process.cwd();
const snapshot = await snapshotProjectConfiguration(projectRoot);
const mode = await prepareNextMode("typecheck", projectRoot);
const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const tscBin = resolve(projectRoot, "node_modules", "typescript", "bin", "tsc");
let completed = false;

try {
  await run(process.execPath, [nextBin, "typegen"], mode.environment);
  await verifyNextGeneratedFiles(projectRoot);
  await run(process.execPath, [tscBin, "--noEmit", "--project", mode.tsconfigPath], {});
  await assertProjectConfigurationUnchanged(snapshot, projectRoot);
  completed = true;
  console.log("Isolated Next type generation and strict TypeScript validation passed.");
} catch (error) {
  process.exitCode = error.exitCode ?? 1;
  throw error;
} finally {
  if (completed) await cleanGeneratedConfiguration("typecheck", projectRoot);
  else await cleanNextMode("typecheck", projectRoot);
}
