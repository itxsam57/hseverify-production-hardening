import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import ts from "typescript";

function loadDecisionRuntime() {
  const out = mkdtempSync(resolve(tmpdir(), "hse-decision-security-runtime-"));
  for (const sourceFile of [
    "src/lib/auth/auth-domain.ts",
    "src/lib/credential/certification-record-repository.ts",
    "src/lib/credential/credential-issuance-domain.ts",
    "src/lib/credential/credential-issuance-repository.ts",
    "src/lib/living-record/living-record-domain.ts",
    "src/lib/living-record/living-record-repository.ts",
    "src/lib/decision/decision-engine-domain.ts",
    "src/lib/decision/decision-engine-repository.ts",
    "src/lib/decision/decision-engine-service.ts"
  ]) {
    let source = readFileSync(sourceFile, "utf8").replace(/^import "server-only";\n?/, "");
    source = source.replace('import { bindTrustedSystemAuditActor } from "../audit/audit-domain";', 'const bindTrustedSystemAuditActor = () => ({ actor: "runtime-test" });');
    source = source.replace('import { getAuditRepository } from "../audit/audit-repository";', 'const getAuditRepository = () => ({ append: async () => {} });');
    source = source.replace('import { getDatabaseClient } from "../database/database";', '');
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const target = resolve(out, sourceFile.replace(/^src\//, "").replace(/\.ts$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
  }
  const dbTarget = resolve(out, "lib/database/database.js");
  mkdirSync(dirname(dbTarget), { recursive: true });
  writeFileSync(dbTarget, "module.exports={getDatabaseClient:async()=>({})};");
  return import(`file://${resolve(out, "lib/decision/decision-engine-service.js")}`);
}

test("decision override runtime keeps tenant boundary and rejects cross-tenant mutation", async () => {
  const { DecisionEngineService } = await loadDecisionRuntime();
  const decisions = new Map([[
    "decision-a",
    { decisionId: "decision-a", tenantId: "tenant-a", state: "PENDING" }
  ]]);
  const overrides = [];
  const service = new DecisionEngineService(
    { append: async () => {} },
    {
      findDecision: async (decisionId, tenantId) => {
        const decision = decisions.get(decisionId);
        return decision?.tenantId === tenantId ? decision : null;
      },
      persistOverride: async (override) => overrides.push(override)
    }
  );

  await assert.rejects(
    () => service.recordOverride({
      overrideId: "override-cross-tenant",
      decisionId: "decision-a",
      tenantId: "tenant-b",
      previousState: "PENDING",
      newState: "APPROVED",
      reason: "manual review",
      evidenceReference: "evidence-1",
      actorReference: "admin-b",
      confirmed: true,
      createdAt: new Date().toISOString(),
      mfaVerifiedAt: new Date().toISOString(),
      notificationRequired: false
    }),
    /outside the tenant boundary/
  );

  assert.equal(overrides.length, 0);
});
