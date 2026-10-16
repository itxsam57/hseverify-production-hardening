import { seedPublishedQuestion } from "./question-publication-fixture.mjs";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "./worker-assessment-search-fixture.mjs";
import { seedPermanentWorkerId } from "./permanent-worker-id-fixture.mjs";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";

const { AuthAccessRepository } = loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const { BillingService } = loadWorkerRegistrationTs("src/lib/billing/billing-service.ts");
const id = (prefix, seed) => prefix + "_" + createHash("sha256").update(seed).digest("hex").slice(0, 24);

// Latest isolated migration stack and schema-valid prerequisites.
// Application creation, Company approval, outbox delivery and notification reads use actual services.
export async function fundingPrincipal(database, identity, role = "worker") {
  const sessionId = "assessment-funding-native-" + randomUUID();
  const now = new Date().toISOString();
  await new AuthAccessRepository(database).authentication.insertSession({
    sessionId, accountId: identity.accountId, activeRole: role,
    tokenHash: createHash("sha256").update(sessionId).digest("hex"),
    csrfTokenHash: createHash("sha256").update("csrf:" + sessionId).digest("hex"),
    userAgentHash: null, ipAddressHash: null, createdAt: now, lastSeenAt: now,
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  });
  return { accountId: identity.accountId, sessionId, activeRole: role, accountStatus: "active",
    tenantMembership: role === "company" ? { tenantId: identity.tenantId, tenantStatus: "active",
      membershipId: identity.membershipId, role: identity.membershipRole ?? "owner", status: "active", overrides: [] } : null,
    ...(role === "company" ? { authorizedTenantPermission: "company.billing.manage" } : {}) };
}

export async function assessmentFundingFixture({policyValues={pass_mark:70}}={}) {
  const fixture = await workerAssessmentSearchFixture();
  const database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try {
    const now = new Date().toISOString(), admin = fixture.credentials.admin.accountId;
    const workerId = await seedPermanentWorkerId(database, fixture.credentials.worker, "f", now);
    const framework = (await database.query("SELECT framework_id FROM assurance_frameworks WHERE framework_reference='SEARCH-WORKER'")).rows[0].framework_id;
    const blueprint = (await database.query("SELECT blueprint_version_id FROM assessment_blueprint_versions WHERE framework_id=$1", [framework])).rows[0].blueprint_version_id;
    const policyId = id("policy", "assessment-funding"), policyVersionId = id("policy_version", "assessment-funding");
    await database.query("INSERT INTO assurance_policy_packs(policy_id,framework_id,policy_reference,title,policy_status,created_by_account_id,created_at,updated_at) VALUES($1,$2,'ASSESSMENT-FUNDING','Funding policy','ACTIVE',$3,$4,$4)", [policyId, framework, admin, now]);
    await database.query("INSERT INTO assurance_policy_versions(policy_version_id,policy_id,version_no,version_status,effective_from,policy_values,created_by_account_id,created_at) VALUES($1,$2,1,'PUBLISHED','2026-01-01T00:00:00Z',$3::jsonb,$4,$5)", [policyVersionId, policyId, JSON.stringify(policyValues), admin, now]);
    const entry = id("assessment_catalogue", "assessment-funding"), version = id("catalogue_version", "assessment-funding");
    await database.query("INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'ASSESSMENT-FUNDING','INACTIVE',NULL,$2,$3,$3)", [entry, admin, now]);
    await database.query("INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'Funded safety assessment','Funding workflow fixture',$3,$4,0,$5,$6)", [version, entry, framework, blueprint, admin, now]);
    await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE' WHERE catalogue_entry_id=$1", [entry, version]);
    const question = id("assessment_question", "assessment-funding"), questionVersion = id("question_version", "assessment-funding"), fingerprint = createHash("sha256").update("funding question").digest("hex");
    await seedPublishedQuestion(database,{questionId:question,versionId:questionVersion,reference:"ASSESSMENT-FUNDING-Q",questionType:"MULTIPLE_CHOICE",prompt:"Which action is safe?",options:["Stop and assess","Ignore the hazard"],answerKey:"Stop and assess",frameworkId:framework,fingerprint,authorAccountId:admin,now});
    const workerLinkId = id("company_worker_link", "assessment-funding"), company = fixture.credentials.company;
    await database.query("INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at) VALUES($1,$2,$3,$4,'permanent_worker_id','active','company',$5,$6,$6,$6,$6)", [workerLinkId, company.tenantId, fixture.credentials.worker.accountId, workerId, company.membershipId, now]);
    const worker = await fundingPrincipal(database, fixture.credentials.worker), companyPrincipal = await fundingPrincipal(database, company, "company");
    const billing = new BillingService(database);
    const checkout = await billing.createCreditCheckout(companyPrincipal, { idempotencyKey: "assessment-funding-fixture", creditUnits: 3, amountMinor: 300, currency: "USD" });
    await billing.completeSandboxCheckout(companyPrincipal, checkout.checkoutId);
    assert.equal((await database.query("SELECT SUM(credit_delta)::int AS credits FROM billing_credit_ledger WHERE tenant_id=$1", [company.tenantId])).rows[0].credits, 3);
    return { ...fixture, worker, company: companyPrincipal, fundingInput: { catalogueVersionId: version, tenantId: company.tenantId, workerLinkId } };
  } catch (error) { await fixture.cleanup(); throw error; }
  finally { await database.close(); }
}
