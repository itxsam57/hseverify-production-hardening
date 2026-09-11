import { PGlite } from "@electric-sql/pglite";
import { createCipheriv, createHmac, randomBytes, scrypt as nodeScrypt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const dataDirectory = process.env.HSE_PGLITE_DATA_DIR;
const pepper = process.env.HSE_AUTH_PEPPER;
if (!dataDirectory || !pepper) throw new Error("HSE_PGLITE_DATA_DIR and HSE_AUTH_PEPPER are required.");

const PASSWORD = "IndependentAudit!Password2026";
const now = new Date().toISOString();
const roles = ["worker", "company", "assessor", "verifier", "admin", "root"];
function token24(value) { return value.replace(/[^A-Za-z0-9_-]/g, "x").padEnd(24, "x").slice(0, 24); }
function scrypt(value, salt, length, options) { return new Promise((resolve, reject) => nodeScrypt(value, salt, length, options, (error, key) => error ? reject(error) : resolve(key))); }
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(`${password}\u0000${pepper}`, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", 16384, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}
function encryptionKey(secret) { return createHmac("sha256", secret).update("hse-auth-encryption-v1").digest(); }
function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(pepper), iv);
  cipher.setAAD(Buffer.from("hse-auth-secret-v1"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(value) {
  let bits = 0, accumulator = 0, output = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte; bits += 8;
    while (bits >= 5) { output += BASE32[(accumulator >>> (bits - 5)) & 31]; bits -= 5; accumulator &= bits === 0 ? 0 : (1 << bits) - 1; }
  }
  if (bits > 0) output += BASE32[(accumulator << (5 - bits)) & 31];
  return output;
}

const database = await PGlite.create(dataDirectory);
const credentials = {};
try {
  for (const role of roles) {
    const accountId = `audit_${role}_account_20260901`;
    const email = `independent.audit.${role}@example.test`;
    const passwordHash = await hashPassword(PASSWORD);
    const workerReference = role === "worker" ? "HSE-REG-INDEPENDENTAUDIT" : null;
    const workerPhone = role === "worker" ? "+923009876540" : null;
    const workerPhoneVerifiedAt = role === "worker" ? now : null;
    await database.query(
      `INSERT INTO auth_accounts(
         account_id,email_normalized,phone_e164,display_name,account_status,password_hash,
         worker_reference,email_verified_at,phone_verified_at,password_set_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,$7,$7,$7)`,
      [accountId, email, workerPhone, `Independent Audit ${role}`, passwordHash, workerReference, now, workerPhoneVerifiedAt]
    );
    await database.query(`INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)`, [accountId, role, now]);
    let totpSecret = null;
    if (role !== "worker") {
      totpSecret = base32Encode(randomBytes(20));
      await database.query(
        `INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at)
         VALUES($1,$2,'totp',$3,'active',NULL,$4,$4)`,
        [`audit_mfa_${role}_20260901`, accountId, encryptSecret(totpSecret), now]
      );
    }
    credentials[role] = { accountId, email, password: PASSWORD, totpSecret };
  }

  const tenantId = `tenant_${token24("independent-audit-company")}`;
  const membershipId = `membership_${token24("independent-audit-owner")}`;
  const caseId = `company_verification_${token24("independent-audit-case")}`;
  const versionId = `company_verification_version_${token24("independent-audit-v1")}`;
  const company = credentials.company;
  await database.query(
    `INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at)
     VALUES($1,'company','Independent Audit Company','active',$2,$3,$3,$3)`,
    [tenantId, company.accountId, now]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
     VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,
    [membershipId, tenantId, company.accountId, now]
  );
  await database.query(
    `INSERT INTO company_verification_cases(
       case_id,tenant_id,owner_account_id,current_version_id,case_status,lock_version,
       created_at,updated_at,submitted_at,verified_at
     ) VALUES($1,$2,$3,NULL,'verified',2,$4,$4,$4,$4)`,
    [caseId, tenantId, company.accountId, now]
  );
  await database.query(
    `INSERT INTO company_verification_versions(
       version_id,case_id,version_number,parent_version_id,version_status,draft_revision,
       legal_name,trading_name,registration_number,country,industry,company_size,website,
       authorized_representative,business_email_normalized,business_phone_e164,
       terms_accepted_at,privacy_accepted_at,created_at,updated_at,submitted_at,terminal_at
     ) VALUES(
       $1,$2,1,NULL,'verified',0,
       'Independent Audit Company','Independent Audit Trading','AUDIT-REG-2026','Pakistan',
       'Construction','51-200','https://independent-audit.example.test',
       'Independent Audit company',$3,'+923009876541',
       $4,$4,$4,$4,$4,$4
     )`,
    [versionId, caseId, company.email, now]
  );
  await database.query(
    `UPDATE company_verification_cases
     SET current_version_id=$2
     WHERE case_id=$1 AND current_version_id IS NULL`,
    [caseId, versionId]
  );
  credentials.company.tenantId = tenantId;
  credentials.company.membershipId = membershipId;
  credentials.company.caseId = caseId;
  credentials.company.versionId = versionId;

  const fixtureFailures = [];
  const workerContact = await database.query(
    `SELECT email_verified_at, phone_e164, phone_verified_at
     FROM auth_accounts
     WHERE account_id=$1`,
    [credentials.worker.accountId]
  );
  const workerContactRow = workerContact.rows[0];
  if (!workerContactRow?.email_verified_at) {
    fixtureFailures.push("Seeded Worker used for identity routes does not have a verified email.");
  }
  if (!workerContactRow?.phone_e164 || !workerContactRow?.phone_verified_at) {
    fixtureFailures.push("Seeded Worker used for identity routes does not have a verified phone.");
  }

  const companyVerification = await database.query(
    `SELECT cases.case_id, cases.current_version_id, cases.case_status,
            versions.version_status, tenants.tenant_status,
            memberships.membership_status
     FROM company_verification_cases AS cases
     JOIN company_verification_versions AS versions
       ON versions.version_id=cases.current_version_id
      AND versions.case_id=cases.case_id
     JOIN platform_tenants AS tenants ON tenants.tenant_id=cases.tenant_id
     JOIN auth_tenant_memberships AS memberships
       ON memberships.tenant_id=cases.tenant_id
      AND memberships.account_id=cases.owner_account_id
     WHERE cases.tenant_id=$1`,
    [tenantId]
  );
  const companyVerificationRow = companyVerification.rows[0];
  if (!companyVerificationRow?.case_id || !companyVerificationRow?.current_version_id) {
    fixtureFailures.push("Seeded Company used for profile routes does not own a Company verification case/current version.");
  }
  if (
    companyVerificationRow?.case_status !== "verified" ||
    companyVerificationRow?.version_status !== "verified" ||
    companyVerificationRow?.tenant_status !== "active" ||
    companyVerificationRow?.membership_status !== "active"
  ) {
    fixtureFailures.push("Seeded Company used for workforce routes is not in a valid fully verified Company state.");
  }

  await mkdir("artifacts/independent-audit", { recursive: true });
  await writeFile(
    "artifacts/independent-audit/fixture-validation.json",
    JSON.stringify({
      checkedAt: now,
      worker: workerContactRow ?? null,
      companyVerification: companyVerificationRow ?? null,
      failures: fixtureFailures
    }, null, 2)
  );
  if (fixtureFailures.length > 0) {
    throw new Error(`Independent audit fixture validation failed:\n- ${fixtureFailures.join("\n- ")}`);
  }

  const proof = await database.query(`SELECT a.email_normalized,r.role,a.account_status FROM auth_accounts a JOIN auth_account_roles r ON r.account_id=a.account_id WHERE a.account_id LIKE 'audit_%_account_20260901' ORDER BY r.role`);
  if (proof.rows.length !== roles.length) throw new Error(`Expected ${roles.length} audit role accounts, found ${proof.rows.length}.`);
  await writeFile("/tmp/independent-audit-credentials.json", JSON.stringify(credentials, null, 2));
  await writeFile("artifacts/independent-audit/seed.json", JSON.stringify({ seededAt: now, roles: proof.rows, companyTenant: tenantId, companyCase: caseId }, null, 2));
  console.log(`Seeded ${proof.rows.length} production-valid independent role accounts.`);
} finally {
  await database.close();
}
