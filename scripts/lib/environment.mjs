import nextEnvironmentPackage from "@next/env";

const { loadEnvConfig } = nextEnvironmentPackage;

let projectEnvironmentLoaded = false;

export function loadProjectEnvironment() {
  if (!projectEnvironmentLoaded) {
    loadEnvConfig(process.cwd());
    projectEnvironmentLoaded = true;
  }
}

function readBoolean(value) {
  return value?.trim().toLowerCase() === "true";
}

function readAppEnvironment(input) {
  const value = input.HSE_APP_ENV?.trim();
  if (["development", "test", "preview", "production"].includes(value)) {
    return value;
  }
  return input.NODE_ENV === "production" ? "production" : "development";
}

export function validateScriptEnvironment(input = process.env) {
  const issues = [];
  const appEnvironment = readAppEnvironment(input);
  const requestedDriver = input.HSE_DATABASE_DRIVER?.trim();
  const databaseDriver = ["pglite", "postgres"].includes(requestedDriver)
    ? requestedDriver
    : appEnvironment === "development" || appEnvironment === "test"
      ? "pglite"
      : "postgres";
  const sessionSecret = input.HSE_SESSION_SECRET?.trim() ?? "";
  const authPepper = input.HSE_AUTH_PEPPER?.trim() || sessionSecret;
  const authSandboxEnabled = readBoolean(input.HSE_ENABLE_AUTH_SANDBOX);
  const authSandboxAccessKey =
    input.HSE_AUTH_SANDBOX_ACCESS_KEY?.trim() || null;
  const databaseUrl = input.DATABASE_URL?.trim() || null;
  const pgliteDataDir =
    input.HSE_PGLITE_DATA_DIR?.trim() ||
    (appEnvironment === "test" ? "memory://" : ".data/postgres");
  const releaseSha = input.HSE_RELEASE_SHA?.trim() || "local-development";
  const demoAuthEnabled = readBoolean(input.HSE_ENABLE_WORKER_DEMO_AUTH);
  const demoDataEnabled = readBoolean(input.HSE_USE_WORKER_DEMO_DATA);

  if (sessionSecret.length < 32) {
    issues.push("HSE_SESSION_SECRET must contain at least 32 characters.");
  }
  if (authPepper.length < 32) {
    issues.push("HSE_AUTH_PEPPER must contain at least 32 characters.");
  }
  if (appEnvironment === "production" && !input.HSE_AUTH_PEPPER?.trim()) {
    issues.push("HSE_AUTH_PEPPER is required in production.");
  }
  if (authSandboxEnabled) {
    if (["preview", "production"].includes(appEnvironment)) {
      issues.push(
        "HSE_ENABLE_AUTH_SANDBOX is restricted to development and test environments."
      );
    }
    if (!authSandboxAccessKey || authSandboxAccessKey.length < 16) {
      issues.push(
        "HSE_AUTH_SANDBOX_ACCESS_KEY must contain at least 16 characters when the authentication sandbox is enabled."
      );
    }
  }
  if (databaseDriver === "postgres") {
    if (!databaseUrl) {
      issues.push("DATABASE_URL is required when HSE_DATABASE_DRIVER=postgres.");
    } else if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
      issues.push("DATABASE_URL must use the postgres:// or postgresql:// scheme.");
    }
  }
  if (
    databaseDriver === "pglite" &&
    (appEnvironment === "preview" || appEnvironment === "production")
  ) {
    issues.push("PGlite is restricted to development and test environments.");
  }
  if (
    (appEnvironment === "preview" || appEnvironment === "production") &&
    releaseSha === "local-development"
  ) {
    issues.push("HSE_RELEASE_SHA is required in preview and production environments.");
  }
  if (appEnvironment === "production" && demoAuthEnabled) {
    issues.push("HSE_ENABLE_WORKER_DEMO_AUTH must be false in production.");
  }
  if (appEnvironment === "production" && demoDataEnabled) {
    issues.push("HSE_USE_WORKER_DEMO_DATA must be false in production.");
  }

  if (issues.length > 0) {
    const error = new Error(`Invalid HSE Verify environment configuration:\n- ${issues.join("\n- ")}`);
    error.issues = issues;
    throw error;
  }

  return {
    appEnvironment,
    databaseDriver,
    databaseUrl,
    pgliteDataDir: databaseDriver === "pglite" ? pgliteDataDir : null,
    releaseSha,
    sessionSecret,
    authPepper,
    authSandboxEnabled,
    authSandboxAccessKey,
    demoAuthEnabled,
    demoDataEnabled
  };
}

export function readProjectEnvironment() {
  loadProjectEnvironment();
  return validateScriptEnvironment(process.env);
}
