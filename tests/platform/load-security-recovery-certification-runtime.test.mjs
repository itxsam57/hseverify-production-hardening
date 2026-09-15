import assert from "node:assert/strict";
import test from "node:test";

import { buildCertificationSnapshot, runLocalRecoveryCertificationFixture } from "../../src/lib/operations/certification-readiness-domain.ts";

test("M3.11 local certification fixture records load security recovery drills", () => {
  const snapshot = runLocalRecoveryCertificationFixture();
  assert.equal(snapshot.status, "certified");
  assert.deepEqual(snapshot.drills.map((drill) => drill.name), [
    "concurrency",
    "tenant_isolation",
    "restore",
    "incident"
  ]);
});

test("M3.11 marks failed drills for remediation", () => {
  const snapshot = buildCertificationSnapshot([
    { name: "concurrency", status: "passed", evidence: "concurrency complete" },
    { name: "tenant_isolation", status: "passed", evidence: "tenant isolation complete" },
    { name: "restore", status: "failed", evidence: "restore failed" },
    { name: "incident", status: "passed", evidence: "incident complete" }
  ]);
  assert.equal(snapshot.status, "attention");
});

test("M3.11 rejects incomplete certification drill evidence", () => {
  assert.throws(() => buildCertificationSnapshot([
    { name: "concurrency", status: "passed", evidence: "concurrency complete" },
    { name: "tenant_isolation", status: "passed", evidence: "tenant isolation complete" },
    { name: "restore", status: "passed", evidence: "" },
    { name: "incident", status: "passed", evidence: "incident complete" }
  ]), /evidence/);
});

test("M3.11 rejects a certification snapshot that omits required recovery drills", () => {
  assert.throws(() => buildCertificationSnapshot([
    { name: "restore", status: "passed", evidence: "restore replay completed" }
  ]), /required drills/);
});
