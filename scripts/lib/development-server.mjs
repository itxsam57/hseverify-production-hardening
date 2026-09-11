import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  assertProjectConfigurationUnchanged,
  cleanNextMode,
  prepareNextMode,
  snapshotProjectConfiguration,
  verifyNextGeneratedFiles
} from "./next-build-system.mjs";

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;

  return new Promise((resolveExit) => {
    let settled = false;
    let timeout;

    const finish = (didExit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      resolveExit(didExit);
    };

    const onExit = () => finish(true);
    child.once("exit", onExit);
    timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
  });
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32" && child.pid) {
    const taskkill = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true }
    );
    await waitForExit(taskkill, 10_000);
    if (!(await waitForExit(child, 10_000))) {
      throw new Error("Windows development process tree did not stop after taskkill.");
    }
    return;
  }

  child.kill("SIGTERM");
  if (!(await waitForExit(child, 10_000))) {
    child.kill("SIGKILL");
    if (!(await waitForExit(child, 5_000))) {
      throw new Error("Development process did not stop after SIGKILL.");
    }
  }
}

async function waitForReady(url, child, output) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Next development server exited before becoming ready.\n${output.join("")}`
      );
    }

    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return response;
    } catch {
      // The server is still starting.
    }

    await delay(500);
  }

  throw new Error(
    `Next development server did not become ready.\n${output.join("")}`
  );
}

function childResult(child) {
  return new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveResult({ code, signal }));
  });
}

export async function runDevelopmentServer({
  args = [],
  probeUrl = null,
  probe = null,
  projectRoot = process.cwd(),
  environment = process.env
} = {}) {
  const snapshot = await snapshotProjectConfiguration(projectRoot);
  const mode = await prepareNextMode("development", projectRoot);
  const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
  const output = [];
  const captureOutput = Boolean(probeUrl);
  let child;
  let requestedSignal = null;
  let stopPromise = null;
  let primaryError = null;
  let responseStatus = null;

  const requestStop = (signal) => {
    requestedSignal = requestedSignal || signal;
    stopPromise = stopPromise || stopProcessTree(child);
  };

  const onSigint = () => requestStop("SIGINT");
  const onSigterm = () => requestStop("SIGTERM");

  try {
    child = spawn(process.execPath, [nextBin, "dev", ...args], {
      cwd: projectRoot,
      env: {
        ...environment,
        ...mode.environment,
        NEXT_TELEMETRY_DISABLED: "1"
      },
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true
    });

    if (captureOutput) {
      child.stdout.on("data", (chunk) => output.push(chunk.toString()));
      child.stderr.on("data", (chunk) => output.push(chunk.toString()));
    }

    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const exit = childResult(child);

    if (probeUrl) {
      const response = await waitForReady(probeUrl, child, output);
      responseStatus = response.status;
      if (probe) {
        await probe({
          initialResponse: response,
          output: () => output.join("")
        });
      } else if (response.status !== 200) {
        throw new Error(
          `Development smoke route returned HTTP ${response.status}.\n${output.join("")}`
        );
      }
      requestStop("SMOKE_COMPLETE");
    }

    const result = await exit;

    if (!requestedSignal && result.signal) {
      throw new Error(`Next development server stopped by signal ${result.signal}.`);
    }

    if (!requestedSignal && result.code !== 0) {
      const error = new Error(
        `Next development server exited with code ${result.code}.\n${output.join("")}`
      );
      error.exitCode = result.code ?? 1;
      throw error;
    }
  } catch (error) {
    primaryError = error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);

    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        requestStop("FINALIZE");
      }
      if (stopPromise) await stopPromise;
      await verifyNextGeneratedFiles(projectRoot);
      await assertProjectConfigurationUnchanged(snapshot, projectRoot);
    } catch (error) {
      if (!primaryError) primaryError = error;
    }

    try {
      await cleanNextMode("development", projectRoot);
    } catch (error) {
      if (!primaryError) primaryError = error;
    }
  }

  if (primaryError) throw primaryError;

  return {
    responseStatus,
    requestedSignal,
    output: output.join("")
  };
}
