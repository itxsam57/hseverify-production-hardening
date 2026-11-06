import { isAbsolute, resolve } from "node:path";
import { openScriptDatabase } from "./lib/database.mjs";
import { readProjectEnvironment } from "./lib/environment.mjs";

// Match the standalone server mode before validating or opening a listener.
process.env.NODE_ENV = "production";
const environment = readProjectEnvironment();

if (environment.appEnvironment === "production" || environment.appEnvironment === "preview") {
  const database = await openScriptDatabase(environment);
  try {
    await database.query("SELECT 1");
  } catch {
    throw new Error("PostgreSQL is unavailable. The application did not start.");
  } finally {
    await database.close();
  }
}

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
