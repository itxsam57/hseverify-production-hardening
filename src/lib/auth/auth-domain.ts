import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as nodeScrypt,
  timingSafeEqual
} from "node:crypto";

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SCRYPT_COST = 16_384;
const PASSWORD_SCRYPT_BLOCK_SIZE = 8;
const PASSWORD_SCRYPT_PARALLELIZATION = 1;

function deriveScrypt(
  value: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(value, salt, length, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const AUTH_ROLES = [
  "worker",
  "company",
  "assessor",
  "verifier",
  "admin",
  "root"
] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export const MFA_REQUIRED_ROLES = [
  "company",
  "assessor",
  "verifier",
  "admin",
  "root"
] as const satisfies readonly AuthRole[];

export type AccountStatus =
  | "pending_email"
  | "pending_phone"
  | "active"
  | "locked"
  | "disabled";

export type OtpPurpose =
  | "registration_email"
  | "registration_phone"
  | "password_reset"
  | "privileged_login";

export type OtpChannel = "email" | "phone";

export const ROLE_LOGIN_PATHS: Record<AuthRole, string> = {
  worker: "/worker/login",
  company: "/company/login",
  assessor: "/assessor/login",
  verifier: "/verifier/login",
  admin: "/admin/login",
  root: "/root/login"
};

export const ROLE_HOME_PATHS: Record<AuthRole, string> = {
  worker: "/worker/dashboard",
  company: "/company/dashboard",
  assessor: "/assessor/dashboard",
  verifier: "/verifier/dashboard",
  admin: "/admin/dashboard",
  root: "/root/dashboard"
};

export function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === "string" && AUTH_ROLES.includes(value as AuthRole);
}

export function roleRequiresMfa(role: AuthRole): boolean {
  return MFA_REQUIRED_ROLES.includes(
    role as (typeof MFA_REQUIRED_ROLES)[number]
  );
}

export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error("Enter a valid email address.");
  }
  return normalized;
}

export function normalizePhone(value: string): string {
  const compact = value.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
    throw new Error(
      "Enter a phone number in international format, for example +923001234567."
    );
  }
  return compact;
}

export function normalizeDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 120) {
    throw new Error("Display name must contain between 2 and 120 characters.");
  }
  return normalized;
}

export function validatePassword(value: string): void {
  if (value.length < 12 || value.length > 128) {
    throw new Error("Password must contain between 12 and 128 characters.");
  }
  if (
    !/[a-z]/.test(value) ||
    !/[A-Z]/.test(value) ||
    !/\d/.test(value) ||
    !/[^A-Za-z0-9]/.test(value)
  ) {
    throw new Error(
      "Password must include uppercase, lowercase, number and symbol characters."
    );
  }
}

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function hashPassword(
  password: string,
  pepper: string
): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await deriveScrypt(
    `${password}\u0000${pepper}`,
    salt,
    PASSWORD_KEY_LENGTH,
    {
      N: PASSWORD_SCRYPT_COST,
      r: PASSWORD_SCRYPT_BLOCK_SIZE,
      p: PASSWORD_SCRYPT_PARALLELIZATION,
      maxmem: 64 * 1024 * 1024
    }
  );
  return [
    "scrypt",
    PASSWORD_SCRYPT_COST,
    PASSWORD_SCRYPT_BLOCK_SIZE,
    PASSWORD_SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
  pepper: string
): Promise<boolean> {
  const [
    algorithm,
    costText,
    blockText,
    parallelText,
    saltText,
    hashText,
    extra
  ] = stored.split("$");
  if (
    algorithm !== "scrypt" ||
    !costText ||
    !blockText ||
    !parallelText ||
    !saltText ||
    !hashText ||
    extra
  ) {
    return false;
  }
  const cost = Number(costText);
  const blockSize = Number(blockText);
  const parallelization = Number(parallelText);
  if (
    !Number.isSafeInteger(cost) ||
    !Number.isSafeInteger(blockSize) ||
    !Number.isSafeInteger(parallelization) ||
    cost < PASSWORD_SCRYPT_COST ||
    blockSize < 1 ||
    parallelization < 1
  ) {
    return false;
  }
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    const actual = await deriveScrypt(
      `${password}\u0000${pepper}`,
      salt,
      expected.length,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: 64 * 1024 * 1024
      }
    );
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createIdentifier(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

export function createOpaqueToken(byteLength = 32): string {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 24 ||
    byteLength > 128
  ) {
    throw new Error("Opaque token byte length is outside the permitted range.");
  }
  return randomBytes(byteLength).toString("base64url");
}

export function hashOpaqueValue(
  value: string,
  pepper: string,
  context: string
): string {
  return createHmac("sha256", pepper)
    .update(context)
    .update("\u0000")
    .update(value)
    .digest("base64url");
}

export function createOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtpCode(input: {
  challengeId: string;
  code: string;
  destinationHash: string;
  pepper: string;
}): string {
  return createHmac("sha256", input.pepper)
    .update("hse-auth-otp-v1")
    .update("\u0000")
    .update(input.challengeId)
    .update("\u0000")
    .update(input.destinationHash)
    .update("\u0000")
    .update(input.code)
    .digest("base64url");
}

export function verifyOtpCode(input: {
  challengeId: string;
  code: string;
  destinationHash: string;
  pepper: string;
  expectedHash: string;
}): boolean {
  if (!/^\d{6}$/.test(input.code)) {
    return false;
  }
  const actual = Buffer.from(hashOtpCode(input), "base64url");
  const expected = Buffer.from(input.expectedHash, "base64url");
  return constantTimeEqual(actual, expected);
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "hidden email";
  return `${local.slice(0, 1)}${"*".repeat(
    Math.max(2, Math.min(8, local.length - 1))
  )}@${domain}`;
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}${"*".repeat(
    Math.max(4, phone.length - 7)
  )}${phone.slice(-4)}`;
}

export function createWorkerRegistrationReference(accountId: string): string {
  const digest = createHash("sha256")
    .update(accountId)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `HSE-REG-${digest}`;
}

function base32Encode(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
      accumulator &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(value: string): Buffer {
  const normalized = value
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/\s+/g, "");
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
      accumulator &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

export function createTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCounter(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
}

export function createTotpCode(secret: string, counter: number): string {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error("Invalid TOTP counter.");
  }
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return ((binary >>> 0) % 10 ** TOTP_DIGITS)
    .toString()
    .padStart(TOTP_DIGITS, "0");
}

export function verifyTotp(input: {
  secret: string;
  code: string;
  now?: Date;
  lastAcceptedCounter?: number | null;
  window?: number;
}): { valid: boolean; counter: number | null } {
  if (!/^\d{6}$/.test(input.code)) {
    return { valid: false, counter: null };
  }
  const current = totpCounter(input.now);
  const window = input.window ?? 1;
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = current + offset;
    if (
      candidate < 0 ||
      (input.lastAcceptedCounter ?? -1) >= candidate
    ) {
      continue;
    }
    const expected = Buffer.from(createTotpCode(input.secret, candidate));
    const supplied = Buffer.from(input.code);
    if (constantTimeEqual(expected, supplied)) {
      return { valid: true, counter: candidate };
    }
  }
  return { valid: false, counter: null };
}

function encryptionKey(secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("hse-auth-encryption-v1")
    .digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from("hse-auth-secret-v1"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString(
    "base64url"
  )}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(value: string, secret: string): string {
  const [version, ivText, tagText, ciphertextText, extra] = value.split(".");
  if (
    version !== "v1" ||
    !ivText ||
    !tagText ||
    !ciphertextText ||
    extra
  ) {
    throw new Error("Invalid encrypted secret format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(ivText, "base64url")
  );
  decipher.setAAD(Buffer.from("hse-auth-secret-v1"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
