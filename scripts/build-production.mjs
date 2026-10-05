import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertProjectConfigurationUnchanged,
  cleanGeneratedConfiguration,
  cleanNextMode,
  prepareNextMode,
  snapshotProjectConfiguration,
  verifyNextGeneratedFiles
} from "./lib/next-build-system.mjs";

const projectRoot = process.cwd();
const workerBuild = spawnSync(process.execPath,["scripts/build-outbox-worker.mjs"],{stdio:"inherit"});
if (workerBuild.status !== 0) throw new Error("Outbox worker production build failed.");
const snapshot = await snapshotProjectConfiguration(projectRoot);
const mode = await prepareNextMode("production-build", projectRoot);
const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBin, "build"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ...mode.environment,
    NEXT_TELEMETRY_DISABLED: "1"
  },
  stdio: "inherit",
  windowsHide: true
});

try {
  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveResult({ code, signal }));
  });

  if (result.signal) {
    throw new Error(`Next production build stopped by signal ${result.signal}.`);
  }
  if (result.code !== 0) {
    const error = new Error(`Next production build exited with code ${result.code}.`);
    error.exitCode = result.code ?? 1;
    throw error;
  }

  await verifyNextGeneratedFiles(projectRoot);

  const standaloneRoot = resolve(projectRoot, ".next", "standalone");
  await mkdir(resolve(standaloneRoot, ".next", "static"), { recursive: true });
  await cp(resolve(projectRoot, ".next", "static"), resolve(standaloneRoot, ".next", "static"), { recursive: true });
  try {
    await stat(resolve(projectRoot, "public"));
    await cp(resolve(projectRoot, "public"), resolve(standaloneRoot, "public"), { recursive: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await assertProjectConfigurationUnchanged(snapshot, projectRoot);
  await cleanGeneratedConfiguration("production-build", projectRoot);
  console.log("Deterministic Next production build passed without source configuration changes.");
} catch (error) {
  await cleanNextMode("production-build", projectRoot);
  process.exitCode = error.exitCode ?? 1;
  throw error;
}
