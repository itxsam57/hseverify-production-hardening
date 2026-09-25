import { isAbsolute, resolve } from "node:path";

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
