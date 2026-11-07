import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const TEAM_PASSWORD = "CompanyJourneyTeam!2026";
const BILLING_WEBHOOK_SECRET = "company-journey-billing-webhook-secret-2026";
const ACTION_FIXTURE_ID = `assurance_action_${"Z".repeat(24)}`;
const ACTION_FIXTURE_ORDER_ID = `assurance_order_${"Y".repeat(24)}`;
const ACTION_FIXTURE_TARGET_ID = `assurance_target_${"X".repeat(24)}`;
const ACTION_FIXTURE_CASE_ID = `assurance_case_${"W".repeat(24)}`;
const ACTION_FIXTURE_LINK_ID = `company_worker_link_${"V".repeat(24)}`;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, offset = 0) {
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const position = digest.at(-1) & 15;
  return String((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("No port."));
        else resolve(address.port);
      });
    });
  });
}

async function login(page, baseUrl, role, credential, offset = 0) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret, offset));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== `/${role}/login`, { timeout: 20_000 });
}


async function seedPolicy(databaseDirectory) {
  const db = new PGlite(databaseDirectory);
  try {
    const now = "2026-01-01T00:00:00.000Z";
    const frameworkId = `framework_${"J".repeat(24)}`;
    const policyId = `policy_${"J".repeat(24)}`;
    const versionId = `policy_version_${"J".repeat(24)}`;
    await db.query(
      `INSERT INTO assurance_frameworks(
         framework_id,framework_reference,title,created_by_account_id,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$5)`,
      [frameworkId, "COMPANY-JOURNEY-FRAME", "Company Journey Framework", "audit_admin_account_20260901", now]
    );
    await db.query(
      `INSERT INTO assurance_policy_packs(
         policy_id,framework_id,policy_reference,title,created_by_account_id,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$6)`,
      [policyId, frameworkId, "COMPANY-JOURNEY-POLICY", "Company Journey Policy", "audit_admin_account_20260901", now]
    );
    await db.query(
      `INSERT INTO assurance_policy_versions(
         policy_version_id,policy_id,version_no,effective_from,effective_to,
         policy_values,override_allowed_fields,override_directions,created_by_account_id,created_at
       ) VALUES($1,$2,1,$3,NULL,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8)`,
      [
        versionId,
        policyId,
        now,
        JSON.stringify({ pass_mark: 80, max_attempts: 2, recording_required: true }),
        JSON.stringify(["pass_mark", "max_attempts"]),
        JSON.stringify({ pass_mark: "MINIMUM", max_attempts: "MAXIMUM" }),
        "audit_admin_account_20260901",
        now
      ]
    );
  } finally {
    await db.close();
  }
}

async function seedActionCentreControlFixture(databaseDirectory, company, worker) {
  const db = new PGlite(databaseDirectory);
  try {
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO assurance_orders(
         order_id,tenant_id,created_by_membership_id,order_name,order_reference,
         requested_identity_checks,requested_evidence_checks,assessment_framework_references,
         interview_required,order_status,submitted_at,created_at,updated_at
       ) VALUES($1,$2,$3,'Action Centre Control Fixture','ACTION-CONTROL-FIXTURE',
         '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,FALSE,'SUBMITTED',$4,$4,$4)`,
      [ACTION_FIXTURE_ORDER_ID, company.tenantId, company.membershipId, now]
    );
    await db.query(
      `INSERT INTO assurance_order_workers(
         target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,
         target_status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)`,
      [
        ACTION_FIXTURE_TARGET_ID,
        ACTION_FIXTURE_ORDER_ID,
        company.tenantId,
        ACTION_FIXTURE_LINK_ID,
        worker.accountId,
        now
      ]
    );
    await db.query(
      `INSERT INTO assurance_cases(
         case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
         case_status,owner_kind,next_action,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,'Created','company',$7,$8,$8)`,
      [
        ACTION_FIXTURE_CASE_ID,
        ACTION_FIXTURE_ORDER_ID,
        ACTION_FIXTURE_TARGET_ID,
        company.tenantId,
        ACTION_FIXTURE_LINK_ID,
        worker.accountId,
        "Company follow-up action for browser acceptance.",
        now
      ]
    );
    await db.query(
      `INSERT INTO assurance_action_items(
         action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,due_at,
         owner_kind,allowed_action,deep_link,statutory,action_status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,'info',$6,NULL,'company','open_case',$7,FALSE,'open',$8,$8)`,
      [
        ACTION_FIXTURE_ID,
        company.tenantId,
        ACTION_FIXTURE_ORDER_ID,
        ACTION_FIXTURE_CASE_ID,
        worker.accountId,
        "Company follow-up action for browser acceptance.",
        `/company/assurance-orders/${ACTION_FIXTURE_ORDER_ID}#${ACTION_FIXTURE_CASE_ID}`,
        now
      ]
    );
  } finally {
    await db.close();
  }
}

test("Company owner completes organization, workforce, Team, assurance, policy, report and tenant-scope workflows in Chromium", { timeout: 300_000 }, async () => {
  const root = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-company-journey-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "company-complete-browser",
    HSE_SESSION_SECRET: "company-complete-session-secret-2026-00000000000",
    HSE_AUTH_PEPPER: "company-complete-auth-pepper-2026-0000000000000",
    HSE_BILLING_WEBHOOK_SECRET: BILLING_WEBHOOK_SECRET,
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs"]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: root,
        env: environment,
        encoding: "utf8"
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    await seedPolicy(databaseDirectory);
    const credentials = JSON.parse(await readFile("/tmp/independent-audit-credentials.json", "utf8"));
    await seedActionCentreControlFixture(databaseDirectory, credentials.company, credentials.worker);
    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/company/login`,
      projectRoot: root,
      environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const company = await companyContext.newPage();
        const workerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const worker = await workerContext.newPage();
        try {
          await login(company, baseUrl, "company", credentials.company);

          // Organization: create both unit types, edit, archive, restore.
          await company.goto(`${baseUrl}/company/organization`, { waitUntil: "networkidle" });
          await company.getByLabel("Unit type").selectOption("site");
          await company.getByLabel("Name").first().fill("Journey Site");
          await company.getByLabel("Formatted address").first().fill("1 Journey Road, Islamabad");
          await company.getByLabel("Phone").first().fill("+923001110001");
          await company.getByLabel("Website").first().fill("https://journey-site.example.test");
          await company.getByLabel("Email").first().fill("site@journey.example.test");
          await company.getByRole("button", { name: "Create unit" }).click();
          await company.getByText("Site created.", { exact: true }).waitFor({ timeout: 15_000 });
          await company.reload({ waitUntil: "networkidle" });
          await company.getByRole("heading", { name: "Journey Site", exact: true }).waitFor();

          await company.getByLabel("Unit type").selectOption("department");
          await company.getByLabel("Name").first().fill("Journey Department");
          await company.getByLabel("Formatted address").first().fill("1 Journey Road, Islamabad");
          await company.getByLabel("Phone").first().fill("+923001110002");
          await company.getByLabel("Website").first().fill("https://journey-dept.example.test");
          await company.getByLabel("Email").first().fill("department@journey.example.test");
          await company.getByRole("button", { name: "Create unit" }).click();
          await company.getByText("Department created.", { exact: true }).waitFor({ timeout: 15_000 });
          await company.reload({ waitUntil: "networkidle" });

          let siteCard = company.locator("article").filter({ hasText: "Journey Site" }).first();
          await siteCard.getByLabel("Name").fill("Journey Site Updated");
          await siteCard.getByRole("button", { name: "Save changes" }).click();
          await siteCard.getByText("Company unit details saved.", { exact: true }).waitFor({ timeout: 15_000 });
          await company.reload({ waitUntil: "networkidle" });
          siteCard = company.locator("article").filter({ hasText: "Journey Site Updated" }).first();
          await siteCard.getByRole("button", { name: "Archive site" }).click();
          await company.getByRole("dialog").getByRole("button", { name: "Archive site" }).click();
          await company.reload({ waitUntil: "networkidle" });
          siteCard = company.locator("article").filter({ hasText: "Journey Site Updated" }).first();
          await siteCard.getByRole("button", { name: "Restore site" }).waitFor({ timeout: 15_000 });
          await siteCard.getByRole("button", { name: "Restore site" }).click();
          await company.reload({ waitUntil: "networkidle" });
          siteCard = company.locator("article").filter({ hasText: "Journey Site Updated" }).first();
          await siteCard.getByRole("button", { name: "Archive site" }).waitFor({ timeout: 15_000 });

          let departmentCard = company.locator("article").filter({hasText:"Journey Department"}).first();
          await departmentCard.getByLabel("Name").fill("Journey Department Updated");
          await departmentCard.getByRole("button",{name:"Save changes"}).click();
          await departmentCard.getByText("Company unit details saved.",{exact:true}).waitFor();
          await company.reload({waitUntil:"networkidle"});
          departmentCard=company.locator("article").filter({hasText:"Journey Department Updated"}).first();
          await departmentCard.getByRole("button",{name:"Archive department"}).click();
          await company.getByRole("dialog").getByRole("button",{name:"Archive department"}).click();
          await company.reload({waitUntil:"networkidle"});
          departmentCard=company.locator("article").filter({hasText:"Journey Department Updated"}).first();
          await departmentCard.getByRole("button",{name:"Restore department"}).click();
          await company.reload({waitUntil:"networkidle"});
          await departmentCard.getByRole("button",{name:"Archive department"}).waitFor();
          console.log("ACTUAL_COMPANY_UNITS site and department create/edit/archive/restore persisted across reloads");

          // Workforce invitations: single, resend, revoke, bulk with mixed validity.
          await company.goto(`${baseUrl}/company/invitations`, { waitUntil: "networkidle" });
          const single = company.locator("section").filter({ hasText: "Invite one Worker" }).first();
          await single.getByLabel("Worker email").fill("pending.journey.worker@example.test");
          await single.getByRole("button", { name: "Create Worker invitation" }).click();
          await single.getByText(/Worker invitation created/).waitFor({ timeout: 15_000 });
          await company.reload({ waitUntil: "networkidle" });
          let invitationCard = company.locator("article").filter({ hasText: "pending.journey.worker@example.test" }).first();
          await invitationCard.getByRole("button", { name: "Resend with new link" }).click();
          await invitationCard.getByText(/Wait before resending this Worker invitation/i).waitFor({ timeout: 15_000 });
          await company.reload({ waitUntil: "networkidle" });
          invitationCard = company.locator("article").filter({ hasText: "pending.journey.worker@example.test" }).first();
          await invitationCard.getByRole("button", { name: "Revoke" }).click();
          await company.getByRole("dialog").getByRole("button", { name: "Revoke invitation" }).click();
          await company.reload({ waitUntil: "networkidle" });
          invitationCard = company.locator("article").filter({ hasText: "pending.journey.worker@example.test" }).first();
          await invitationCard.getByText("revoked", { exact: true }).waitFor({ timeout: 15_000 });

          const bulk = company.locator("section").filter({ hasText: "Invite multiple Workers" }).first();
          await bulk.getByLabel("Worker CSV").fill("email\nbulk.one@example.test\nnot-an-email");
          await bulk.getByRole("button", { name: "Process bulk Worker invitations" }).click();
          await bulk.getByText(/1 Worker invitation created; 1 row need attention/).waitFor({ timeout: 15_000 });

          // Registration code -> real Worker redemption -> active Company link.
          const codeSection = company.locator("section").filter({ hasText: "Create registration code" }).first();
          await codeSection.getByLabel("Site default").selectOption({label:"Journey Site Updated"});
          await codeSection.getByLabel("Department default").selectOption({label:"Journey Department Updated"});
          await codeSection.getByLabel("Usage limit").fill("1");
          const registrationExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
          await codeSection.getByLabel("Expiry").fill(registrationExpiry);
          await codeSection.getByRole("button", { name: "Create Company registration code" }).click();
          await codeSection.getByText(/Company registration code created/).waitFor({ timeout: 15_000 });
          const registrationCode = (await codeSection.locator("p strong").last().innerText()).trim();
          assert(registrationCode.length >= 8);

          await login(worker, baseUrl, "worker", credentials.worker);
          await worker.goto(`${baseUrl}/worker/company-access`, { waitUntil: "networkidle" });
          await worker.getByLabel("Registration code").fill(registrationCode);
          await worker.getByRole("button", { name: "Join Company with code" }).click();
          await worker.getByText(/Company registration code accepted/).waitFor({ timeout: 15_000 });
          await worker.reload({ waitUntil: "networkidle" });
          await worker.getByRole("heading", { name: "Independent Audit Company" }).waitFor();

          await company.reload({ waitUntil: "networkidle" });
          await company.getByRole("heading", { name: "Worker links" }).waitFor();
          await company.getByText(credentials.worker.email, { exact: true }).waitFor();
          const workerLinksSection = company.locator('section[aria-labelledby="worker-links-heading"]');
          const activeWorkerLinkCard = workerLinksSection.locator("article").filter({ hasText: credentials.worker.email }).first();
          const activeWorkerLinkId = (await activeWorkerLinkCard.locator("code").innerText()).trim();
          assert.match(activeWorkerLinkId, /^company_worker_link_[A-Za-z0-9_-]{24}$/);

          // Company Team: invite, enroll with MFA, scope/update, suspend/reactivate/revoke.
          await company.goto(`${baseUrl}/company/team`, { waitUntil: "networkidle" });
          await company.getByLabel("Staff email").fill("journey.team.member@example.test");
          await company.getByLabel("Company Team role").selectOption("viewer");
          await company.getByRole("button", { name: "Create Company Team invitation" }).click();
          await company.getByText(/Company Team invitation created/).waitFor({ timeout: 15_000 });
          const invitationPath = (await company.locator("strong").filter({ hasText: "/staff/invite/" }).first().innerText()).trim();
          assert(invitationPath.startsWith("/staff/invite/"));

          const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          const member = await memberContext.newPage();
          await member.goto(`${baseUrl}${invitationPath}`, { waitUntil: "domcontentloaded" });
          await member.getByLabel("Full name").fill("Journey Team Member");
          await member.getByLabel("Create password").fill(TEAM_PASSWORD);
          await member.getByLabel("Confirm password").fill(TEAM_PASSWORD);
          await member.getByRole("button", { name: "Continue to authenticator setup" }).click();
          const teamSecret = (await member.locator(".security-key-card strong").innerText()).trim();
          await member.getByLabel("Authenticator code").fill(totp(teamSecret));
          await member.getByRole("button", { name: "Activate MFA and finish enrollment" }).click();
          await member.getByText("Enrollment complete", { exact: false }).waitFor({ timeout: 15_000 });

          await login(member, baseUrl, "company", { email: "journey.team.member@example.test", password: TEAM_PASSWORD, totpSecret: teamSecret }, 1);
          await member.goto(`${baseUrl}/company/dashboard`, { waitUntil: "networkidle" });
          await member.getByRole("heading", { name: "Independent Audit Company", exact: true }).waitFor();
          const staffCookiesBefore = await memberContext.cookies();
          assert(staffCookiesBefore.some(cookie => cookie.httpOnly), "actual staff login must hold an authenticated session");

          await company.reload({ waitUntil: "networkidle" });
          let memberCard = company.locator("article").filter({ hasText: "Journey Team Member" }).first();
          await memberCard.getByLabel("Company Team role").selectOption("manager");
          await memberCard.getByLabel("Site scope (optional)").selectOption({label:"Journey Site Updated"});
          await memberCard.getByLabel("Department scope (optional)").selectOption({label:"Journey Department Updated"});
          await memberCard.getByRole("button", { name: "Save Team access" }).click();
          await memberCard.getByText(/role, permissions and unit scope saved/i).waitFor({ timeout: 15_000 });
          await company.reload({ waitUntil: "networkidle" });
          memberCard = company.locator("article").filter({ hasText: "Journey Team Member" }).first();
          const assignedSiteId=await memberCard.getByLabel("Site scope (optional)").inputValue();
          const assignedDepartmentId=await memberCard.getByLabel("Department scope (optional)").inputValue();
          for (const [kind,name] of [["site","Journey Site Updated"],["department","Journey Department Updated"]]) {
            await company.goto(`${baseUrl}/company/organization`,{waitUntil:"networkidle"});
            const unit=company.locator("article").filter({hasText:name}).first();
            await unit.getByRole("button",{name:`Archive ${kind}`}).click();
            await company.getByRole("dialog").getByRole("button",{name:`Archive ${kind}`}).click();
            await company.reload({waitUntil:"networkidle"});
            await worker.reload({waitUntil:"networkidle"});
            assert.equal(await worker.getByText(name,{exact:false}).count(),0,`archived ${kind} must not remain current Worker placement`);
          }
          await company.goto(`${baseUrl}/company/team`,{waitUntil:"networkidle"});
          memberCard=company.locator("article").filter({hasText:"Journey Team Member"}).first();
          assert.equal(await memberCard.getByLabel("Site scope (optional)").inputValue(),"");
          assert.equal(await memberCard.getByLabel("Department scope (optional)").inputValue(),"");
          assert.equal(await memberCard.locator(`option[value="${assignedSiteId}"]`).count(),0);
          assert.equal(await memberCard.locator(`option[value="${assignedDepartmentId}"]`).count(),0);
          await memberCard.getByLabel("Site scope (optional)").evaluate((select,value)=>{select.add(new Option("Forged archived site",value));},assignedSiteId);
          await memberCard.getByLabel("Site scope (optional)").selectOption(assignedSiteId);
          await memberCard.getByRole("button",{name:"Save Team access"}).click();
          await memberCard.getByText(/Select an active Company site\./).waitFor();
          await company.reload({waitUntil:"networkidle"});
          memberCard=company.locator("article").filter({hasText:"Journey Team Member"}).first();
          assert.equal(await memberCard.getByLabel("Site scope (optional)").inputValue(),"");
          for (const [kind,name] of [["site","Journey Site Updated"],["department","Journey Department Updated"]]) {
            await company.goto(`${baseUrl}/company/organization`,{waitUntil:"networkidle"});
            await company.locator("article").filter({hasText:name}).first().getByRole("button",{name:`Restore ${kind}`}).click();
            await company.reload({waitUntil:"networkidle"});
          }
          await worker.reload({waitUntil:"networkidle"});
          assert.equal(await worker.getByText(/Journey Site Updated|Journey Department Updated/).count(),0,"restore must not recreate Worker placements");
          await company.goto(`${baseUrl}/company/team`,{waitUntil:"networkidle"});
          memberCard=company.locator("article").filter({hasText:"Journey Team Member"}).first();
          assert.equal(await memberCard.getByLabel("Site scope (optional)").inputValue(),"");
          assert.equal(await memberCard.getByLabel("Department scope (optional)").inputValue(),"");
          console.log("ACTUAL_ASSIGNED_UNIT_ARCHIVE staff/Worker placements removed, forged archived placement denied, restore does not recreate placement");
          await memberCard.getByLabel("Company Team role").selectOption("admin");
          await memberCard.locator('input[name="permissions"][value="company.members.manage"]').check();
          await memberCard.locator('input[name="permissions"][value="company.members.read"]').check();
          await memberCard.locator('input[name="permissions"][value="company.reports.export"]').uncheck();
          await memberCard.getByRole("button",{name:"Save Team access"}).click();
          await memberCard.getByText(/role, permissions and unit scope saved/i).waitFor();
          await member.goto(`${baseUrl}/company/team`,{waitUntil:"networkidle"});
          assert.equal(new URL(member.url()).pathname,"/company/team");
          await member.getByRole("heading",{name:"Invite Company Team member",exact:true}).waitFor();
          const staffInvite=member.locator('section[aria-labelledby="company-team-invite-title"]');
          assert.equal(await staffInvite.getByLabel("Company Team role").locator('option[value="owner"],option[value="admin"]').count(),0);
          await staffInvite.getByLabel("Company Team role").selectOption("manager");
          assert.equal(await staffInvite.locator('input[name="permissions"][value="company.reports.export"]').count(),0);
          await staffInvite.getByLabel("Staff email").fill("forbidden-grant@example.test");
          await staffInvite.locator("form").evaluate(form=>{const input=document.createElement("input");input.type="checkbox";input.name="permissions";input.value="company.reports.export";input.checked=true;form.append(input);});
          await staffInvite.getByRole("button",{name:"Create Company Team invitation"}).click();
          await staffInvite.getByText("Your current Company role cannot complete that Team change.",{exact:true}).waitFor();
          await member.reload({waitUntil:"networkidle"});
          await staffInvite.getByLabel("Staff email").fill("forbidden-owner@example.test");
          await staffInvite.getByLabel("Company Team role").evaluate(select=>select.add(new Option("Forged owner","owner")));
          await staffInvite.getByLabel("Company Team role").selectOption("owner");
          await staffInvite.getByRole("button",{name:"Create Company Team invitation"}).click();
          await staffInvite.getByText("Your current Company role cannot complete that Team change.",{exact:true}).waitFor();
          await member.reload({waitUntil:"networkidle"});
          await staffInvite.getByLabel("Staff email").fill("allowed-viewer@example.test");
          await staffInvite.getByLabel("Company Team role").selectOption("viewer");
          await staffInvite.getByRole("button",{name:"Create Company Team invitation"}).click();
          await staffInvite.getByText(/Company Team invitation created/).waitFor();
          console.log("ACTUAL_STAFF_PERMISSION_CEILING own live admin session cannot grant absent permission or owner role; permitted viewer invitation succeeds");
          await company.reload({waitUntil:"networkidle"});
          memberCard=company.locator("article").filter({hasText:"Journey Team Member"}).first();
          await memberCard.getByLabel("Company Team role").selectOption("manager");
          await memberCard.getByRole("button",{name:"Save Team access"}).click();
          await memberCard.getByText(/role, permissions and unit scope saved/i).waitFor();
          await company.reload({waitUntil:"networkidle"});
          memberCard=company.locator("article").filter({hasText:"Journey Team Member"}).first();
          await memberCard.getByRole("button", { name: "Suspend" }).click();
          await company.getByRole("dialog").getByRole("button", { name: "Suspend access" }).click();
          await company.reload({ waitUntil: "networkidle" });
          memberCard = company.locator("article").filter({ hasText: "Journey Team Member" }).first();
          await memberCard.getByRole("button", { name: "Reactivate" }).waitFor({ timeout: 15_000 });
          await member.goto(`${baseUrl}/company/dashboard`, { waitUntil: "networkidle" });
          assert.equal(await member.getByRole("heading", { name: "Independent Audit Company", exact: true }).count(), 0, "suspended membership must remove existing-session tenant access");
          assert.equal(new URL(member.url()).pathname, "/access-denied");
          await member.goto(`${baseUrl}/company/team`, { waitUntil: "networkidle" });
          assert.equal(new URL(member.url()).pathname, "/access-denied");
          assert.equal(await member.getByRole("heading", { name: "HSE Verify could not complete this request.", exact: true }).count(), 0);
          console.log("ACTUAL_COMPANY_STAFF_SUSPENSION existing signed-in session loses Company tenant dashboard access");

          await memberCard.getByRole("button", { name: "Reactivate" }).click();
          await company.reload({ waitUntil: "networkidle" });
          memberCard = company.locator("article").filter({ hasText: "Journey Team Member" }).first();
          await memberCard.getByRole("button", { name: "Suspend" }).waitFor({ timeout: 15_000 });
          await member.goto(`${baseUrl}/company/dashboard`, { waitUntil: "networkidle" });
          await member.getByRole("heading", { name: "Independent Audit Company", exact: true }).waitFor();

          await memberCard.getByRole("button", { name: "Revoke" }).click();
          await company.getByRole("dialog").getByRole("button", { name: "Revoke access" }).click();
          await company.reload({ waitUntil: "networkidle" });
          memberCard = company.locator("article").filter({ hasText: "Journey Team Member" }).first();
          await memberCard.getByText("revoked", { exact: true }).waitFor({ timeout: 15_000 });
          await member.goto(`${baseUrl}/company/dashboard`, { waitUntil: "networkidle" });
          assert.equal(await member.getByRole("heading", { name: "Independent Audit Company", exact: true }).count(), 0, "revoked membership must remove existing-session tenant access");
          assert.equal(new URL(member.url()).pathname, "/access-denied");
          await member.goto(`${baseUrl}/company/team`, { waitUntil: "networkidle" });
          assert.equal(new URL(member.url()).pathname, "/access-denied");
          assert.equal(await member.getByRole("heading", { name: "HSE Verify could not complete this request.", exact: true }).count(), 0);
          console.log("ACTUAL_COMPANY_STAFF_REVOCATION reactivated signed-in session loses Company tenant dashboard access on revocation");

          await memberContext.close();

          // Assurance order: valid submitted case, Action Centre visibility, cancellation.
          await company.goto(`${baseUrl}/company/assurance-orders/new`, { waitUntil: "networkidle" });
          await company.getByLabel("Order name").fill("Journey Assurance Order");
          await company.getByLabel("Order reference", { exact: true }).fill("JOURNEY-ORDER-001");
          await company.locator('input[name="workerLinkIds"]').first().check();
          await company.getByLabel("Funding method").selectOption("worker");
          await company.getByRole("button", { name: "Save Draft" }).click();
          await company.waitForURL(/\/company\/assurance-orders\//, { timeout: 15_000 });
          await company.getByText("DRAFT", { exact: true }).waitFor();
          await company.getByRole("button", { name: "Validate Order" }).click();
          await company.getByText("READY", { exact: true }).waitFor({ timeout: 15_000 });
          await company.getByRole("button", { name: "Submit Order" }).click();
          await company.getByText("SUBMITTED", { exact: true }).waitFor({ timeout: 15_000 });
          await company.getByRole("heading", { name: "Worker cases" }).waitFor();
          await company.goto(`${baseUrl}/company/action-centre`, { waitUntil: "networkidle" });
          const actionItem = company.locator("article").filter({ hasText: "Complete or correct the Worker identity requirements for this assurance case." }).first();
          await actionItem.waitFor({ timeout: 15_000 });

          // Action Centre mutations: exercise assignment, safe snooze and acknowledgement.
          let companyAction = company.locator("article").filter({ hasText: "Company follow-up action for browser acceptance." }).first();
          await companyAction.getByLabel("Internal Company membership ID").fill(credentials.company.membershipId);
          await companyAction.getByRole("button", { name: "Assign owner" }).click();
          await company.reload({ waitUntil: "networkidle" });
          companyAction = company.locator("article").filter({ hasText: "Company follow-up action for browser acceptance." }).first();
          const pastSnooze = new Date(Date.now()-86400000).toISOString().slice(0,16);
          await companyAction.getByLabel("Until").fill(pastSnooze);
          await companyAction.getByLabel("Reason").fill("Deferred until scheduled internal follow-up.");
          await companyAction.getByRole("button", { name: "Snooze" }).click();
          await companyAction.getByRole("alert").filter({hasText:"Snooze requires a future date and a reason."}).waitFor();
          assert.equal(await companyAction.getByLabel("Until").inputValue(),pastSnooze);
          assert.equal(await companyAction.getByLabel("Reason").inputValue(),"Deferred until scheduled internal follow-up.");
          assert.equal(await companyAction.getByText(/status: snoozed/i).count(),0);
          await companyAction.getByLabel("Until").fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
          await companyAction.getByRole("button", { name: "Snooze" }).click();
          await companyAction.getByText(/status: snoozed/i).waitFor({ timeout: 15_000 });
          await companyAction.getByRole("button", { name: "Mark internally acknowledged" }).click();
          await companyAction.getByText(/status: acknowledged/i).waitFor({ timeout: 15_000 });

          await actionItem.getByRole("link", { name: "Open", exact: true }).click();
          await company.waitForURL(/\/company\/assurance-orders\//, { timeout: 15_000 });
          await company.getByText("JOURNEY-ORDER-001", { exact: false }).first().waitFor();
          await company.getByRole("button", { name: "Cancel Submitted Order" }).click();
          await company.getByText("CANCELLED", { exact: true }).waitFor({ timeout: 15_000 });

          // Negative order branch: no Worker target -> validation failure, then cancel draft.
          await company.goto(`${baseUrl}/company/assurance-orders/new`, { waitUntil: "networkidle" });
          await company.getByLabel("Order name").fill("Journey Invalid Order");
          await company.getByLabel("Order reference", { exact: true }).fill("JOURNEY-ORDER-INVALID");
          await company.getByRole("button", { name: "Save Draft" }).click();
          await company.waitForURL(/\/company\/assurance-orders\//, { timeout: 15_000 });
          await company.getByRole("button", { name: "Validate Order" }).click();
          await company.getByText("VALIDATION_FAILED", { exact: true }).waitFor({ timeout: 15_000 });
          await company.getByText(/Add at least one active linked Worker/).waitFor();
          await company.getByLabel("Active Worker link ID").fill(activeWorkerLinkId);
          await company.getByRole("button", { name: "Add Workers" }).click();
          await company.getByText("DRAFT", { exact: true }).waitFor({ timeout: 15_000 });
          await company.getByRole("button", { name: "Validate Order" }).click();
          await company.getByText("READY", { exact: true }).waitFor({ timeout: 15_000 });
          await company.getByRole("button", { name: "Cancel Draft" }).click();
          await company.getByText("CANCELLED", { exact: true }).waitFor({ timeout: 15_000 });

          // Effective policy: real permitted Company tightening.
          await company.goto(`${baseUrl}/company/settings/policy`, { waitUntil: "networkidle" });
          await company.getByLabel("Policy reference").fill("COMPANY-JOURNEY-POLICY");
          await company.getByLabel("Override values JSON").fill('{"pass_mark":85}');
          await company.getByLabel("Effective from").fill("2026-09-23T00:00");
          await company.getByRole("button", { name: "Save immutable override version" }).click();
          await company.getByText("COMPANY-JOURNEY-POLICY", { exact: false }).first().waitFor({ timeout: 15_000 });
          await company.getByText(/pass_mark.*85/i).first().waitFor({ timeout: 15_000 });

          // Sandbox billing: browser checkout -> signed provider capture -> browser refund
          // -> signed refund callback -> browser reconciliation.
          await company.goto(`${baseUrl}/company/billing`, { waitUntil: "networkidle" });
          await company.getByLabel("Credits").fill("10");
          await company.getByLabel("Amount (minor units)").first().fill("5000");
          await company.getByLabel("Currency").fill("USD");
          await company.getByRole("button", { name: "Create sandbox checkout" }).click();

          const checkoutCard = company.locator(".card").filter({ hasText: "Sandbox checkouts" }).first();
          const checkoutRow = checkoutCard.locator("tbody tr").first();
          await checkoutRow.getByText("REQUIRES_PROVIDER", { exact: true }).waitFor({ timeout: 15_000 });
          const checkoutReference = (await checkoutRow.locator("code").innerText()).trim();
          assert.match(checkoutReference, /^sandbox_checkout_/);

          const invoiceCard = company.locator(".card").filter({ hasText: "Invoices" }).first();
          const invoiceId = (await invoiceCard.locator("tbody tr td").first().innerText()).trim();
          assert.match(invoiceId, /^billing_invoice_/);

          const captureBody = JSON.stringify({
            id: "provider-event-company-journey-capture",
            type: "payment.captured",
            checkoutReference,
            amountMinor: 5000,
            currency: "USD"
          });
          const invalidCapture = await fetch(`${baseUrl}/api/billing/webhook`, {
            method: "POST", headers: { "content-type":"application/json", "x-hse-billing-signature":"0".repeat(64) }, body: captureBody
          });
          assert.equal(invalidCapture.status,401);
          console.log("ACTUAL_BILLING_INVALID_SIGNATURE rejected before capture");
          const captureResponse = await fetch(`${baseUrl}/api/billing/webhook`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-hse-billing-signature": createHmac("sha256", BILLING_WEBHOOK_SECRET).update(captureBody).digest("hex")
            },
            body: captureBody
          });
          assert.equal(captureResponse.status, 200, await captureResponse.text());
          await company.reload({ waitUntil: "networkidle" });
          await invoiceCard.getByText("PAID", { exact: true }).waitFor({ timeout: 15_000 });
          const duplicateCapture = await fetch(`${baseUrl}/api/billing/webhook`, {
            method:"POST", headers:{"content-type":"application/json","x-hse-billing-signature":createHmac("sha256",BILLING_WEBHOOK_SECRET).update(captureBody).digest("hex")}, body:captureBody
          });
          assert.equal(duplicateCapture.status,200);
          const changedCapture = JSON.stringify({...JSON.parse(captureBody),amountMinor:6000});
          const changedReplay = await fetch(`${baseUrl}/api/billing/webhook`, {
            method:"POST", headers:{"content-type":"application/json","x-hse-billing-signature":createHmac("sha256",BILLING_WEBHOOK_SECRET).update(changedCapture).digest("hex")}, body:changedCapture
          });
          assert.equal(changedReplay.status,400);
          await company.reload({waitUntil:"networkidle"});
          console.log("ACTUAL_BILLING_CAPTURE_REPLAY duplicate accepted idempotently; changed signed payload denied; balance remains10");

          await company.locator(".metric-card").filter({ hasText: "Company credits" }).getByText("10", { exact: true }).waitFor();

          const refundCard = company.locator(".card").filter({
            has: company.getByRole("heading", { name: "Refunds", exact: true })
          }).first();
          await refundCard.getByLabel("Invoice ID").fill(invoiceId);
          await refundCard.getByLabel("Amount (minor units)").fill("2000");
          await refundCard.getByRole("button", { name: "Request sandbox refund" }).click();
          const refundItem = refundCard.locator("li").filter({ hasText: "REQUIRES_PROVIDER" }).first();
          await refundItem.waitFor({ timeout: 15_000 });
          const refundReference = (await refundItem.locator("code").innerText()).trim();
          assert.match(refundReference, /^sandbox_refund_/);

          const refundBody = JSON.stringify({
            id: "provider-event-company-journey-refund",
            type: "refund.succeeded",
            refundReference,
            amountMinor: 2000,
            currency: "USD"
          });
          const refundResponse = await fetch(`${baseUrl}/api/billing/webhook`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-hse-billing-signature": createHmac("sha256", BILLING_WEBHOOK_SECRET).update(refundBody).digest("hex")
            },
            body: refundBody
          });
          assert.equal(refundResponse.status, 200, await refundResponse.text());
          await company.reload({ waitUntil: "networkidle" });
          await company.getByText("PARTIALLY_REFUNDED", { exact: true }).waitFor({ timeout: 15_000 });
          await company.getByText(/SUCCEEDED/).waitFor({ timeout: 15_000 });
          await company.locator(".metric-card").filter({ hasText: "Company credits" }).getByText("6", { exact: true }).waitFor();

          const duplicateRefund = await fetch(`${baseUrl}/api/billing/webhook`, {
            method:"POST", headers:{"content-type":"application/json","x-hse-billing-signature":createHmac("sha256",BILLING_WEBHOOK_SECRET).update(refundBody).digest("hex")}, body:refundBody
          });
          assert.equal(duplicateRefund.status,200);
          await refundCard.getByLabel("Invoice ID").fill(invoiceId);
          await refundCard.getByLabel("Amount (minor units)").fill("3000");
          await refundCard.getByRole("button",{name:"Request sandbox refund"}).click();
          const finalRefund = refundCard.locator("li").filter({hasText:"REQUIRES_PROVIDER"}).first();
          await finalRefund.waitFor({timeout:3000});
          const finalReference=(await finalRefund.locator("code").innerText()).trim();
          const finalBody=JSON.stringify({id:"provider-event-company-journey-final-refund",type:"refund.succeeded",refundReference:finalReference,amountMinor:3000,currency:"USD"});
          const finalResponse=await fetch(`${baseUrl}/api/billing/webhook`,{
            method:"POST",headers:{"content-type":"application/json","x-hse-billing-signature":createHmac("sha256",BILLING_WEBHOOK_SECRET).update(finalBody).digest("hex")},body:finalBody
          });
          assert.equal(finalResponse.status,200);
          await company.reload({waitUntil:"networkidle"});
          await company.getByText("REFUNDED",{exact:true}).waitFor();
          await company.locator(".metric-card").filter({hasText:"Company credits"}).getByText("0",{exact:true}).waitFor();
          console.log("ACTUAL_BILLING_FULL_REFUND partial2000 then remaining3000; full refund confirmed with balance0");
          await company.getByRole("button", { name: "Run reconciliation" }).click();
          await company.getByText(/CLEAN — 0 discrepancy item/i).waitFor({ timeout: 15_000 });

          const buyCredits=company.locator(".card").filter({hasText:"Buy sandbox credits"}).first();
          await buyCredits.getByLabel("Credits",{exact:true}).fill("5");
          await buyCredits.getByLabel("Amount (minor units)",{exact:true}).fill("2500");
          await buyCredits.getByRole("button",{name:"Create sandbox checkout"}).click();
          await company.reload({waitUntil:"networkidle"});
          const pendingCheckouts=company.locator(".card").filter({hasText:"Sandbox checkouts"}).first();
          assert.equal(await pendingCheckouts.locator("tbody tr").count(),2,"second explicit purchase creates a distinct checkout");
          await pendingCheckouts.getByText("REQUIRES_PROVIDER",{exact:true}).waitFor();
          await company.locator(".metric-card").filter({hasText:"Company credits"}).getByText("0",{exact:true}).waitFor();
          console.log("ACTUAL_BILLING_NEW_PURCHASE distinct second checkout remains provider-pending and grants no unpaid credits");

          // Report queue.
          await company.goto(`${baseUrl}/company/reports`, { waitUntil: "networkidle" });
          await company.getByLabel("Report type", { exact: true }).selectOption("workforce-status");
          await company.getByLabel("Format", { exact: true }).selectOption("csv");
          await company.getByLabel("Definition name (for saving)", { exact: true }).fill("report_company_journey_001");
          await company.getByRole("button", { name: "Save report definition", exact: true }).click();
          await company.waitForURL("**/company/reports?notice=saved");
          await company.getByRole("status").filter({ hasText: "Your report definition is saved." }).waitFor();
          const savedReport = company.locator("[data-definition-id]").filter({ hasText: "report_company_journey_001" });
          assert.equal(await savedReport.count(), 1);
          const definitionId = await savedReport.getAttribute("data-definition-id");
          assert.match(definitionId, /^report_definition_[A-Za-z0-9_-]{24}$/);
          await company.reload({ waitUntil: "domcontentloaded" });
          const persistedDefinition = company.locator('[data-definition-id="' + definitionId + '"]');
          await persistedDefinition.getByText("report_company_journey_001", { exact: true }).waitFor();
          await persistedDefinition.getByRole("button", { name: "Queue saved report", exact: true }).click();
          await company.waitForURL("**/company/reports?notice=queued");
          await company.getByRole("status").filter({ hasText: "Your report is queued." }).waitFor();
          const queuedReport = company.locator("[data-report-id]");
          assert.equal(await queuedReport.count(), 1);
          const reportId = await queuedReport.getAttribute("data-report-id");
          assert.ok(reportId, "The persisted queue must expose its server-assigned report ID.");
          await company.reload({ waitUntil: "domcontentloaded" });
          const persistedReport = company.locator('[data-report-id="' + reportId + '"]');
          await persistedReport.getByText("Workforce status", { exact: true }).waitFor();
          await persistedReport.getByText("queued", { exact: true }).waitFor();
          assert.match(await persistedReport.innerText(), /CSV/);
          assert.match(await persistedReport.innerText(), /Saved definition version 1/);

          // Tenant-scope CRUD demonstration.
          await company.goto(`${baseUrl}/company/tenant-scope`, { waitUntil: "networkidle" });
          await company.getByLabel("Demonstration key").fill("journey-record");
          await company.getByLabel("Title").fill("Journey Tenant Record");
          await company.getByLabel("Note").fill("Synthetic tenant-scope journey data only.");
          await company.getByRole("button", { name: "Create demonstration record" }).click();
          await company.getByRole("heading", { name: "Journey Tenant Record" }).waitFor({ timeout: 15_000 });
          let demoCard = company.locator("[data-company-scope-record]").filter({ hasText: "Journey Tenant Record" }).first();
          await demoCard.getByLabel("Title").fill("Journey Tenant Record Updated");
          // The Save button dispatches a React useActionState Server Action.
          // Never reload before the server confirms its update; that can
          // abort an in-flight POST on a busy CI runner and falsely report a
          // missing Company record.
          await demoCard.getByRole("button", { name: "Save demonstration record" }).click();
          await demoCard.getByText("Demonstration record updated inside the current Company tenant.", { exact: true }).waitFor({ timeout: 20_000 });
          await demoCard.getByRole("heading", { name: "Journey Tenant Record Updated", exact: true }).waitFor({ timeout: 20_000 });
          await company.reload({ waitUntil: "networkidle" });
          demoCard = company.locator("[data-company-scope-record]").filter({ hasText: "Journey Tenant Record Updated" }).first();
          await demoCard.waitFor({ timeout: 15_000 });
          console.log("ACTUAL_COMPANY_SCOPE_UPDATE acked Server Action and persisted updated tenant record across reload");
          await demoCard.getByRole("button", { name: "Delete" }).click();
          await company.getByRole("dialog").getByRole("button", { name: "Delete demonstration record" }).click();
          await company.getByText(/deleted from the current Company tenant/i).waitFor({ timeout: 15_000 });

          // Dashboard reflects live persisted state rather than placeholder session text.
          await company.goto(`${baseUrl}/company/dashboard`, { waitUntil: "networkidle" });
          await company.getByRole("heading", { name: "Independent Audit Company" }).waitFor();
          const workerMetric = company.locator(".metric-card").filter({ hasText: "Workers" }).first();
          await workerMetric.getByText("1", { exact: true }).waitFor();
          const ordersMetric = company.locator(".metric-card").filter({ hasText: "Assurance Orders" }).first();
          await ordersMetric.getByText(/3 total/i).waitFor();
        } finally {
          await companyContext.close();
          await workerContext.close();
          await browser.close();
        }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

    const db = new PGlite(databaseDirectory);
    try {
      const [links, orders, team, overrides, reports, billing, actions] = await Promise.all([
        db.query(`SELECT link_status FROM company_worker_links WHERE worker_account_id='audit_worker_account_20260901'`),
        db.query(`SELECT order_reference,order_status FROM assurance_orders WHERE order_reference LIKE 'JOURNEY-ORDER%'`),
        db.query(`SELECT membership_status,membership_role FROM auth_tenant_memberships WHERE account_id IN (SELECT account_id FROM auth_accounts WHERE email_normalized='journey.team.member@example.test')`),
        db.query(`SELECT override_values FROM tenant_policy_overrides WHERE tenant_id='tenant_independent-audit-compan'`),
        db.query(`SELECT delivery.report_id,delivery.status,delivery.format,delivery.report_type,delivery.definition_version,version.name
                    FROM report_deliveries AS delivery
                    JOIN report_definitions AS definition ON definition.definition_id=delivery.definition_id
                         AND definition.tenant_id=delivery.tenant_id AND definition.owner_kind='company'
                    JOIN report_definition_versions AS version ON version.definition_id=delivery.definition_id
                         AND version.version=delivery.definition_version
                   WHERE delivery.tenant_id='tenant_independent-audit-compan'
                     AND version.name='report_company_journey_001'`),
        db.query(`SELECT i.status,i.refunded_amount_minor,
                         (SELECT COALESCE(SUM(credit_delta),0) FROM billing_credit_ledger WHERE tenant_id=i.tenant_id) AS credit_balance,
                         (SELECT COUNT(*)::int FROM billing_reconciliation_runs WHERE tenant_id=i.tenant_id AND status='CLEAN') AS clean_runs
                    FROM billing_invoices AS i
                   WHERE i.tenant_id='tenant_independent-audit-compan' AND i.amount_minor=5000
                   ORDER BY i.created_at DESC
                   LIMIT 1`),
        db.query(`SELECT action_status,internal_owner_membership_id
                    FROM assurance_action_items
                   WHERE action_id=$1`, [ACTION_FIXTURE_ID])
      ]);
      const sites=await db.query("SELECT name,site_status,revision FROM company_sites WHERE tenant_id='tenant_independent-audit-compan'");
      const departments=await db.query("SELECT name,department_status,revision FROM company_departments WHERE tenant_id='tenant_independent-audit-compan'");
      assert(sites.rows.some(row=>row.name==="Journey Site Updated" && row.site_status==="active" && Number(row.revision)===6));
      assert(departments.rows.some(row=>row.name==="Journey Department Updated" && row.department_status==="active" && Number(row.revision)===6));
      const purchases=await db.query("SELECT checkout_id,status FROM billing_checkouts WHERE tenant_id='tenant_independent-audit-compan'");
      assert.equal(purchases.rows.length,2);
      assert.equal(new Set(purchases.rows.map(row=>row.checkout_id)).size,2);
      assert(purchases.rows.some(row=>row.status==="REQUIRES_PROVIDER"));

      const workerScope=await db.query("SELECT link_id,site_id,department_id,code_id FROM company_worker_links WHERE worker_account_id='audit_worker_account_20260901'");
      assert.equal(workerScope.rows[0].site_id,null);assert.equal(workerScope.rows[0].department_id,null);
      assert(workerScope.rows[0].code_id,"original registration-code lineage retained");
      const scopeHistory=await db.query("SELECT metadata FROM platform_audit_events WHERE actor_tenant_id='tenant_independent-audit-compan' AND metadata->>'workerLinkId'=$1 ORDER BY audit_sequence",[workerScope.rows[0].link_id]);
      assert.equal(scopeHistory.rows.length,2);
      assert(scopeHistory.rows[0].metadata.previousSiteId);
      assert(scopeHistory.rows[0].metadata.previousDepartmentId);
      assert.equal(scopeHistory.rows[1].metadata.previousSiteId,null);
      assert(scopeHistory.rows[1].metadata.previousDepartmentId);
      const teamHistory=await db.query("SELECT ended_at,ended_reason FROM company_team_unit_assignments WHERE membership_id IN(SELECT membership_id FROM auth_tenant_memberships WHERE account_id IN(SELECT account_id FROM auth_accounts WHERE email_normalized='journey.team.member@example.test'))");
      assert.equal(teamHistory.rows.length,1);assert(teamHistory.rows[0].ended_at);
      assert.equal(teamHistory.rows[0].ended_reason,"Site archived");
      console.log("ACTUAL_UNIT_ARCHIVE_HISTORY same Worker/link source retained, two immutable prior-scope events and ended staff assignment");

      const forbiddenInvites=await db.query("SELECT invitation_id FROM auth_staff_invitations WHERE email_normalized IN('forbidden-grant@example.test','forbidden-owner@example.test')");
      assert.equal(forbiddenInvites.rows.length,0);
      const allowedInvite=await db.query("SELECT invitation_status FROM auth_staff_invitations WHERE email_normalized='allowed-viewer@example.test'");
      assert.equal(allowedInvite.rows.length,1);assert.equal(allowedInvite.rows[0].invitation_status,"pending");
      console.log("ACTUAL_STAFF_PERMISSION_DB forged grants/roles leave no invitation; legitimate viewer invitation persisted");
      assert.equal(links.rows[0]?.link_status, "active");
      assert(orders.rows.some((row) => row.order_reference === "JOURNEY-ORDER-001" && row.order_status === "CANCELLED"));
      assert(orders.rows.some((row) => row.order_reference === "JOURNEY-ORDER-INVALID" && row.order_status === "CANCELLED"));
      assert.equal(team.rows[0]?.membership_status, "revoked");
      assert.equal(team.rows[0]?.membership_role, "manager");
      const staffDenials = await db.query(`
        SELECT e.event_id, e.metadata->>'sessionId' AS denied_session_id, a.audit_event_id
          FROM auth_security_events e
          JOIN auth_accounts accounts ON accounts.account_id=e.account_id
          LEFT JOIN platform_audit_events a ON a.source_kind='auth_security_event' AND a.source_event_id=e.event_id
         WHERE accounts.email_normalized='journey.team.member@example.test'
           AND e.event_type='access_denied' AND e.active_role='company'
           AND e.metadata->>'reason'='permission_denied'`);
      assert(staffDenials.rows.length >= 4, "dashboard and Team denials on suspension and revocation must persist");
      assert(staffDenials.rows.every(row => row.audit_event_id), "every actual denial must retain its mirrored audit");
      const staffSessions = await db.query(`SELECT session_id, revoked_at FROM auth_sessions WHERE account_id IN
        (SELECT account_id FROM auth_accounts WHERE email_normalized='journey.team.member@example.test')`);
      assert.equal(staffSessions.rows.length,1,"one existing session used throughout membership transitions");
      assert.equal(staffSessions.rows[0].revoked_at,null,"membership denial must be proved against an existing authenticated session");
      assert(staffDenials.rows.every(row => row.denied_session_id === staffSessions.rows[0].session_id), "all denials must bind to the exact existing staff session");
      console.log("ACTUAL_COMPANY_STAFF_DENIAL_DB revoked membership, same authenticated session, persisted denials with complete audit mirrors");

      assert(overrides.rows.length >= 1);
      assert.equal(reports.rows.length, 1, "The named saved definition must produce exactly one persisted report request.");
      assert.ok(reports.rows[0].report_id, "The report request retains its server-assigned ID.");
      assert.equal(reports.rows[0].name, "report_company_journey_001");
      assert.equal(reports.rows[0].definition_version, 1);
      assert.equal(reports.rows[0].report_type, "workforce-status");
      assert.equal(reports.rows[0].format, "csv");
      assert.equal(reports.rows[0].status, "queued");
      assert.equal(billing.rows[0]?.status, "REFUNDED");
      assert.equal(Number(billing.rows[0]?.refunded_amount_minor), 5000);
      assert.equal(Number(billing.rows[0]?.credit_balance), 0);
      assert(Number(billing.rows[0]?.clean_runs) >= 1);
      const creditHistory=await db.query("SELECT credit_delta FROM billing_credit_ledger WHERE tenant_id='tenant_independent-audit-compan'");
      assert.deepEqual(creditHistory.rows.map(row=>Number(row.credit_delta)).sort((a,b)=>a-b),[-6,-4,10]);
      console.log("ACTUAL_BILLING_DB exact original capture and two retained refund ledger entries, no replay double-credit or double-refund");

      assert.equal(actions.rows[0]?.action_status, "acknowledged");
      assert.equal(actions.rows[0]?.internal_owner_membership_id, credentials.company.membershipId);
    } finally {
      await db.close();
    }
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
