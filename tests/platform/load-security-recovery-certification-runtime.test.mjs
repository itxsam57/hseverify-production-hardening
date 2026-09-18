import assert from "node:assert/strict";
import test from "node:test";

import { assertCertificationSnapshotIsReady, buildCertificationSnapshot, runCertificationDrills, runLocalRecoveryCertificationFixture } from "../../src/lib/operations/certification-readiness-domain.ts";

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

test("M3.11 records evidence from executed drill boundaries", async () => {
  const snapshot = await runCertificationDrills({
    concurrency: () => "parallel command replay completed",
    tenant_isolation: () => "cross tenant access rejected",
    restore: () => "backup restore verification completed",
    incident: () => "incident recovery transition completed"
  });
  assert.equal(snapshot.status, "certified");
  assert.equal(snapshot.drills[0].evidence, "parallel command replay completed");
});

test("M3.11 marks an executed failed drill for recovery", async () => {
  const snapshot = await runCertificationDrills({
    concurrency: () => "ok",
    tenant_isolation: () => "ok",
    restore: () => { throw new Error("restore verification failed"); },
    incident: () => "ok"
  });
  assert.equal(snapshot.status, "attention");
  assert.equal(snapshot.drills.find((drill) => drill.name === "restore").status, "failed");
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

test("M3.11 rejects duplicate certification drills", () => {
  assert.throws(() => buildCertificationSnapshot([
    { name: "concurrency", status: "passed", evidence: "first concurrency run" },
    { name: "concurrency", status: "passed", evidence: "duplicate concurrency run" },
    { name: "tenant_isolation", status: "passed", evidence: "tenant isolation complete" },
    { name: "restore", status: "passed", evidence: "restore replay completed" },
    { name: "incident", status: "passed", evidence: "incident complete" }
  ]), /duplicate drills/);
});


test("M3.11 only allows certified snapshots through release readiness boundary", () => {
  const snapshot = runLocalRecoveryCertificationFixture();
  assert.doesNotThrow(() => assertCertificationSnapshotIsReady(snapshot));
  assert.throws(() => assertCertificationSnapshotIsReady(buildCertificationSnapshot([
    { name: "concurrency", status: "passed", evidence: "ok" },
    { name: "tenant_isolation", status: "passed", evidence: "ok" },
    { name: "restore", status: "failed", evidence: "failed restore" },
    { name: "incident", status: "passed", evidence: "ok" }
  ])), /not ready/);
});
