export type HseAppEnvironment = "development" | "test" | "preview" | "production";
export type HseDatabaseDriver = "pglite" | "postgres";

import { credentialSigningKeyId } from "../credential/credential-issuance-domain";

import type { OtpProviderConfig } from "../auth/otp-provider-transport";

export type RuntimeEnvironment = {
  registrationOtpProviders?: OtpProviderConfig;
  publicBaseUrl?: string;
  appEnvironment: HseAppEnvironment;
  databaseDriver: HseDatabaseDriver;
  databaseUrl: string | null;
  pgliteDataDir: string | null;
  releaseSha: string;
  sessionSecret: string;
  credentialSigningSecret?: string;
  credentialSigningPreviousSecrets?: readonly string[];
  authPepper: string;
  authSandboxEnabled: boolean;
  authSandboxAccessKey: string | null;
  demoAuthEnabled: boolean;
  demoDataEnabled: boolean;
};

export class EnvironmentConfigurationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid HSE Verify environment configuration:\n- ${issues.join("\n- ")}`);
    this.name = "EnvironmentConfigurationError";
    this.issues = issues;
  }
}

function readBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function readAppEnvironment(input: NodeJS.ProcessEnv): HseAppEnvironment {
  const value = input.HSE_APP_ENV?.trim();
  if (
    value === "development" ||
    value === "test" ||
    value === "preview" ||
    value === "production"
  ) {
    return value;
  }

  if (input.NODE_ENV === "production") {
    return "production";
  }

  return "development";
}

function defaultDriver(environment: HseAppEnvironment): HseDatabaseDriver {
  return environment === "development" || environment === "test"
    ? "pglite"
    : "postgres";
}

function readCredentialSigningConfiguration(input: NodeJS.ProcessEnv, issues: string[]) {
  const credentialSigningSecret = input.HSE_CREDENTIAL_SIGNING_SECRET?.trim() || undefined;
  let credentialSigningPreviousSecrets: string[] = [];
  const rawPrevious = input.HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS;
  const validSecret = (value: unknown): value is string =>
    typeof value === "string" && value.length >= 32 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
  if (credentialSigningSecret && !validSecret(credentialSigningSecret)) {
    issues.push("HSE_CREDENTIAL_SIGNING_SECRET must contain 32 to 512 characters without control characters.");
  }
  if (rawPrevious && rawPrevious.length > 16384) {
    issues.push("HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS must not exceed 16 KB.");
  } else if (rawPrevious?.trim()) {
    try {
      const values: unknown = JSON.parse(rawPrevious);
      if (!Array.isArray(values) || values.length > 8) throw new Error();
      const normalized: unknown[] = values.map(value => typeof value === "string" ? value.trim() : value);
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

export function validateRuntimeEnvironment(
  input: NodeJS.ProcessEnv = process.env
): RuntimeEnvironment {
  const issues: string[] = [];
  const appEnvironment = readAppEnvironment(input);
  const requestedDriver = input.HSE_DATABASE_DRIVER?.trim();
  const databaseDriver: HseDatabaseDriver =
    requestedDriver === "pglite" || requestedDriver === "postgres"
      ? requestedDriver
      : defaultDriver(appEnvironment);
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

  if (
    appEnvironment === "production" &&
    !input.HSE_AUTH_PEPPER?.trim()
  ) {
    issues.push("HSE_AUTH_PEPPER is required in production.");
  }

  if (authSandboxEnabled) {
    if (appEnvironment === "preview" || appEnvironment === "production") {
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

  const registrationOtpProviders: OtpProviderConfig = {
    emailApiKey: input.HSE_OTP_EMAIL_API_KEY?.trim(),
    emailFrom: input.HSE_OTP_EMAIL_FROM?.trim(),
    smsAccountSid: input.HSE_OTP_SMS_ACCOUNT_SID?.trim(),
    smsAuthToken: input.HSE_OTP_SMS_AUTH_TOKEN?.trim(),
    smsFrom: input.HSE_OTP_SMS_FROM?.trim()
  };
  const safe = (value: string | undefined, maximum: number) =>
    !!value && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
  if (registrationOtpProviders.emailApiKey || registrationOtpProviders.emailFrom) {
    if (!safe(registrationOtpProviders.emailApiKey, 512) ||
        !safe(registrationOtpProviders.emailFrom, 320) ||
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(registrationOtpProviders.emailFrom ?? "")) {
      issues.push("OTP email requires a valid API key and sender email address.");
    }
  }
  if (registrationOtpProviders.smsAccountSid || registrationOtpProviders.smsAuthToken || registrationOtpProviders.smsFrom) {
    if (!/^AC[0-9a-fA-F]{32}$/.test(registrationOtpProviders.smsAccountSid ?? "") ||
        !safe(registrationOtpProviders.smsAuthToken, 512) ||
        !/^\+[1-9][0-9]{7,14}$/.test(registrationOtpProviders.smsFrom ?? "")) {
      issues.push("OTP SMS requires a valid account SID, auth token and sender number.");
    }
  }

  let publicBaseUrl:string|undefined;
  if(input.HSE_PUBLIC_BASE_URL?.trim()){
   try{
    const url=new URL(input.HSE_PUBLIC_BASE_URL.trim());
    const local=(appEnvironment==="development" || appEnvironment==="test") && url.protocol==="http:" &&
      ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
    if((url.protocol!=="https:" && !local) || url.username || url.password || url.search || url.hash || url.pathname!=="/")throw new Error();
    publicBaseUrl=url.origin;
   }catch{issues.push("HSE_PUBLIC_BASE_URL must be a clean HTTPS origin, or a local HTTP origin in development/test.");}
  }

  if (issues.length > 0) {
    throw new EnvironmentConfigurationError(issues);
  }

  return {
    appEnvironment,
    ...(publicBaseUrl ? {publicBaseUrl}:{}),
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
    demoDataEnabled,
    ...(Object.values(registrationOtpProviders).some(Boolean) ? { registrationOtpProviders } : {})
  };
}
