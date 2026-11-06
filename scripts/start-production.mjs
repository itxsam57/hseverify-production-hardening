import { isAbsolute, resolve } from "node:path";
import { readProjectEnvironment } from "./lib/environment.mjs";

// Match the standalone server mode before validating or opening a listener.
process.env.NODE_ENV = "production";
readProjectEnvironment();

const projectRoot = process.cwd();
const standaloneRoot = resolve(projectRoot, ".next", "standalone");

process.env.HSE_RUNTIME_PROJECT_ROOT = projectRoot;

const configuredDataDirectory = process.env.HSE_PGLITE_DATA_DIR?.trim();
if (
  configuredDataDirectory &&
  configuredDataDirectory !== "memory://" &&
  !configuredDataDirectory.includes("://") &&
  !isAbsolute(configuredDataDirectory)
) {
  process.env.HSE_PGLITE_DATA_DIR = resolve(projectRoot, configuredDataDirectory);
}

process.chdir(standaloneRoot);
await import(resolve(standaloneRoot, "server.js"));
