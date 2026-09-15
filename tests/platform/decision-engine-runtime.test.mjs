import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import ts from "typescript";

function loadDecisionRuntime() {
  const out = mkdtempSync(resolve(tmpdir(), "hse-decision-runtime-"));
  const files = [
    "src/lib/decision/decision-engine-domain.ts",
    "src/lib/decision/decision-engine-repository.ts",
    "src/lib/decision/decision-engine-service.ts",
    "src/lib/auth/auth-domain.ts"
  ];
  for (const sourceFile of files) {
    let source = readFileSync(sourceFile, "utf8").replace(/^import "server-only";\n?/, "");
    if (sourceFile.endsWith("decision-engine-service.ts")) {
      source = source.replace(
        'import { bindTrustedSystemAuditActor } from "../audit/audit-domain";'
        , 'const bindTrustedSystemAuditActor = () => ({ actor: "runtime-test" });'
      );
    }
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const target = resolve(out, sourceFile.replace(/^src\//, "").replace(/\.ts$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
  }
  const dbTarget = resolve(out, "lib/database/database.js");
  mkdirSync(dirname(dbTarget), { recursive: true });
  writeFileSync(dbTarget, "module.exports={getDatabaseClient:async()=>{throw new Error('runtime injects repository')}};");
  return import(`file://${resolve(out, "lib/decision/decision-engine-service.js")}`);
}

test("decision engine runtime persists decision and audit through service boundary and rejects invalid authorization state", async () => {
  const { DecisionEngineService } = await loadDecisionRuntime();
  const decisions = [];
  const audits = [];
  const auditRepository = { append: async (_actor, event) => audits.push(event) };
  const service = new DecisionEngineService(auditRepository, {
    saveDecision: async (decision) => decisions.push(decision),
    saveOverride: async () => {}
  });

  const result = await service.createAndRecord({
    caseId: "case-runtime-1",
    state: "APPROVED",
    reasonCode: "rule_pass",
    explanation: "Runtime decision accepted",
    ruleVersion: "runtime-v1",
    inputReferences: ["evidence-1"]
  });

  assert.equal(result.state, "APPROVED");
  assert.equal(decisions.length, 1);
  assert.equal(audits.length, 1);
  await assert.rejects(
    () => service.createAndRecord({
      caseId: "case-runtime-1",
      state: "INVALID",
      reasonCode: "rule_fail",
      explanation: "Invalid state rejection",
      ruleVersion: "runtime-v1",
      inputReferences: ["evidence-1"]
    }),
    /Unknown decision state/
  );
});
