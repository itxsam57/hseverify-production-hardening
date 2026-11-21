import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const OTHER = Object.freeze({
  accountId: "account_m10501_other_company",
  email: "m10501-other-company@example.test",
  tenantId: "tenant_" + "K".repeat(24),
  membershipId: "membership_" + "K".repeat(24),
  factorId: "factor_m10501_other_company"
});
const ORG_ACTIONS = ["company_organization.created", "company_organization.updated",
  "company_organization.archived", "company_organization.restored"];
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function totp(secret) {
  const cleaned = secret.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const letter of cleaned) {
    const index = B32.indexOf(letter);
    if (index < 0) throw Error("Invalid synthetic MFA secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(
    Array.from({length: Math.floor(bits.length / 8)}, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2))
  )).update(buffer).digest();
  return String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function port() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
async function login(page, base, identity) {
  await page.goto(base + "/company/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/company/dashboard", { timeout: 30000 });
}
async function seedOtherCompany(db, original) {
  const now = new Date().toISOString();
  await db.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,
     email_verified_at,password_set_at,created_at,updated_at)
    SELECT $1,$2,'M105 Another Company','active',password_hash,$3,$3,$3,$3
    FROM auth_accounts WHERE account_id=$4`,
    [OTHER.accountId, OTHER.email, now, original.accountId]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",
    [OTHER.accountId, now]);
  await db.query(`INSERT INTO auth_mfa_factors
    (factor_id,account_id,factor_type,encrypted_secret,factor_status,
     last_accepted_counter,created_at,activated_at)
    SELECT $1,$2,'totp',encrypted_secret,'active',NULL,$3,$3
    FROM auth_mfa_factors WHERE account_id=$4 AND factor_type='totp'`,
    [OTHER.factorId, OTHER.accountId, now, original.accountId]);
  await db.query(`INSERT INTO platform_tenants
    (tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,
     created_at,updated_at,activated_at)
    VALUES($1,'company','M105 Other Tenant','active',$2,$3,$3,$3)`,
    [OTHER.tenantId, OTHER.accountId, now]);
  await db.query(`INSERT INTO auth_tenant_memberships
    (membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,
     created_by_account_id,created_at,updated_at,activated_at)
    VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,
    [OTHER.membershipId, OTHER.tenantId, OTHER.accountId, now]);
}
async function createSite(page, base, name) {
  await page.goto(base + "/company/organization", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Unit type").selectOption("site");
  await page.getByLabel("Name").first().fill(name);
  await page.getByLabel("Formatted address").first().fill("1 Synthetic Audit Way, Lahore");
  await page.getByLabel("Phone").first().fill("+923001001001");
  await page.getByLabel("Website").first().fill("https://audit-site.example.test");
  await page.getByLabel("Email").first().fill("audit-site@example.test");
  await page.getByRole("button", { name: "Create unit", exact: true }).click();
  await page.getByText("Site created.", { exact: true }).waitFor({ timeout: 25000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  const card = page.locator("article").filter({has: page.getByRole("heading", {name, exact: true})}).first();
  const unitId = await card.locator('input[name="unitId"]').first().inputValue();
  assert.ok(unitId.startsWith("site_"), "Actual created Company site must persist and have a record ID");
  return unitId;
}
test("M1.05.01 real two-tenant Company audit shows actor, resource, reason and immutable lifecycle history", {timeout: 225000}, async () => {
  const fixture = await workerAssessmentSearchFixture();
  const base = "http://127.0.0.1:" + (await port());
  const owner = fixture.credentials.company;
  let siteAId, siteBId;
  try {
    const seedDb = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try { await seedOtherCompany(seedDb, owner); }
    finally { await seedDb.close(); }

    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", new URL(base).port],
      probeUrl: base + "/company/login", projectRoot: process.cwd(),
      environment: fixture.environment,
      probe: async () => {
        const browser = await chromium.launch({headless: true});
        try {
          const ownerA = await browser.newPage({viewport: {width: 390,height: 844}});
          const ownerB = await browser.newPage({viewport: {width: 320,height: 740}});
          const anonymous = await browser.newPage();
          await login(ownerA, base, owner);
          await login(ownerB, base, {email: OTHER.email,password: owner.password,totpSecret: owner.totpSecret});

          siteAId = await createSite(ownerA, base, "M10501 Audit Owner A Site");
          await ownerA.goto(base + "/company/audit", {waitUntil: "domcontentloaded"});
          await ownerA.getByRole("heading", {name: "Company audit", exact: true}).waitFor();
          assert.equal(await ownerA.getByRole("columnheader", {name: "Actor", exact: true}).count(), 1,
            "M10501 RED: Company audit hides the actor even though DB records it");
          const created = ownerA.locator("table tbody tr").filter({hasText: "company_organization.created"})
            .filter({hasText: siteAId}).first();
          await created.waitFor();
          assert.match(await created.innerText(), new RegExp(owner.accountId));
          assert.match(await created.innerText(), /organization_unit_created/);
          console.log("M10501_AUDIT_ACTOR_UI_390", "actor, target, and reason visible on real Company audit page");

          await ownerA.goto(base + "/company/organization", {waitUntil: "domcontentloaded"});
          let card = ownerA.locator("article").filter({hasText: "M10501 Audit Owner A Site"}).first();
          await card.getByLabel("Name").fill("M10501 Audit Owner A Site Revised");
          await card.getByRole("button", {name: "Save changes"}).click();
          await card.getByText("Company unit details saved.",{exact: true}).waitFor();
          await ownerA.reload({waitUntil: "domcontentloaded"});
          card = ownerA.locator("article").filter({hasText: "M10501 Audit Owner A Site Revised"}).first();
          await card.getByRole("button", {name: "Archive site"}).click();
          await ownerA.getByRole("dialog").getByRole("button", {name: "Archive site"}).click();
          await ownerA.reload({waitUntil: "domcontentloaded"});
          card = ownerA.locator("article").filter({hasText: "M10501 Audit Owner A Site Revised"}).first();
          await card.getByRole("button", {name: "Restore site"}).click();
          await ownerA.reload({waitUntil: "domcontentloaded"});
          await ownerA.getByRole("button", {name: "Archive site"}).waitFor();
          await ownerA.goto(base + "/company/audit", {waitUntil: "domcontentloaded"});
          for (const action of ORG_ACTIONS) {
            const matching = ownerA.locator("table tbody tr").filter({hasText: action})
              .filter({hasText: siteAId});
            assert.equal(await matching.count(), 1, "History missing transition " + action);
            assert.match(await matching.first().innerText(), new RegExp(owner.accountId));
          }
          console.log("M10501_AUDIT_LIFECYCLE_UI_390", "create, rename, archive, restore retained as four actor-bound records");

          siteBId = await createSite(ownerB, base, "M10501 Tenant B Site");
          await ownerB.goto(base + "/company/audit", {waitUntil: "domcontentloaded"});
          await ownerB.getByRole("heading", {name: "Company audit", exact: true}).waitFor();
          assert.equal(await ownerB.locator("table tbody tr").filter({hasText: siteAId}).count(), 0,
            "Company B can inspect Company A's immutable audit");
          assert.equal(await ownerB.locator("table tbody tr").filter({hasText: siteBId}).count(), 1);
          assert.equal(await ownerA.locator("table tbody tr").filter({hasText: siteBId}).count(), 0);
          console.log("M10501_AUDIT_CROSS_TENANT_UI_320", "both real owners see only own audit resource identifiers");

          await anonymous.goto(base + "/company/audit", {waitUntil: "domcontentloaded"});
          assert.notEqual(new URL(anonymous.url()).pathname, "/company/audit",
            "Signed-out visitor viewed private Company audit");
          console.log("M10501_AUDIT_SIGNED_OUT_DENIED", new URL(anonymous.url()).pathname);
        } finally { await browser.close(); }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

    const db = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      const events = (await db.query(`SELECT audit_event_id,actor_account_id,actor_role,
        actor_tenant_id,actor_membership_id,action_key,outcome,reason_key,
        target_type,target_reference,metadata,occurred_at,recorded_at
        FROM platform_audit_events
        WHERE target_reference=ANY($1::text[])
          AND action_key LIKE 'company_organization.%'
        ORDER BY audit_sequence`,[[siteAId,siteBId]])).rows;
      assert.equal(events.length,5,"Four A lifecycle actions and one B creation must each append exactly one audit record");
      const aEvents=events.filter(e=>e.target_reference===siteAId);
      const bEvents=events.filter(e=>e.target_reference===siteBId);
      assert.deepEqual(aEvents.map(e=>e.action_key),ORG_ACTIONS);
      assert.equal(bEvents.length,1);
      for (const event of events) {
        const isA=event.target_reference===siteAId;
        assert.equal(event.actor_account_id, isA ? owner.accountId : OTHER.accountId);
        assert.equal(event.actor_tenant_id, isA ? owner.tenantId : OTHER.tenantId);
        assert.equal(event.actor_membership_id, isA ? owner.membershipId : OTHER.membershipId);
        assert.equal(event.actor_role,"company");
        assert.equal(event.outcome,"succeeded");
        assert.equal(event.target_type,"resource");
        assert.equal(event.reason_key,
          "organization_unit_" + event.action_key.slice("company_organization.".length),
          "Every Company material transition must capture explicit machine reason key");
        assert.ok(event.occurred_at && event.recorded_at);
      }
      for (const action of ["UPDATE","DELETE"]) {
        await assert.rejects(
          db.query(action==="UPDATE"
            ? "UPDATE platform_audit_events SET reason_key='tampered' WHERE audit_event_id=$1"
            : "DELETE FROM platform_audit_events WHERE audit_event_id=$1",
            [aEvents[0].audit_event_id]),
          /append-only/i, "Immutable audit row was mutable by " + action
        );
      }
      console.log("M10501_IMMUTABLE_DB",JSON.stringify({
        actions:aEvents.map(e=>e.action_key),tenantB:bEvents.length,
        ownerActorsCorrect:5,reasonKeysCorrect:5,mutationRejected:2
      }));
    } finally { await db.close(); }
  } finally { await fixture.cleanup(); }
});
