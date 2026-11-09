import { createHash, createHmac } from "node:crypto";
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

function credentialSigningKeyId(secret) {
  const key = createHmac("sha256", secret).update("hseverify:credential-issuance:signing-key:v1", "utf8").digest();
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function readCredentialSigningConfiguration(input, issues) {
  const credentialSigningSecret = input.HSE_CREDENTIAL_SIGNING_SECRET?.trim() || undefined;
  let credentialSigningPreviousSecrets = [];
  const rawPrevious = input.HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS;
  const validSecret = (value) =>
    typeof value === "string" && value.length >= 32 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
  if (credentialSigningSecret && !validSecret(credentialSigningSecret)) {
    issues.push("HSE_CREDENTIAL_SIGNING_SECRET must contain 32 to 512 characters without control characters.");
  }
  if (rawPrevious && rawPrevious.length > 16384) {
    issues.push("HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS must not exceed 16 KB.");
  } else if (rawPrevious?.trim()) {
    try {
      const values = JSON.parse(rawPrevious);
      if (!Array.isArray(values) || values.length > 8) throw new Error();
      const normalized = values.map(value => typeof value === "string" ? value.trim() : value);
      if (!normalized.every(validSecret)) throw new Error();
      credentialSigningPreviousSecrets = normalized;
    } catch {
      issues.push("HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS must be a JSON array of at most 8 secrets, each 32 to 512 characters.");
    }
  }
  const keys = [...(credentialSigningSecret ? [credentialSigningSecret] : []), ...credentialSigningPreviousSecrets];
  if (keys.every(validSecret) && new Set(keys.map(credentialSigningKeyId)).size !== keys.length) {
    issues.push("HSE_CREDENTIAL_SIGNING secrets must have unique key IDs.");
  }
  return { credentialSigningSecret, credentialSigningPreviousSecrets: Object.freeze(credentialSigningPreviousSecrets) };
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
  const { credentialSigningSecret, credentialSigningPreviousSecrets } = readCredentialSigningConfiguration(input, issues);
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
  if (appEnvironment === "production" && !credentialSigningSecret) {
    issues.push("HSE_CREDENTIAL_SIGNING_SECRET is required in production.");
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
    ...(credentialSigningSecret ? { credentialSigningSecret } : {}),
    credentialSigningPreviousSecrets,
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
