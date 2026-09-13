import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile("src/lib/decision/decision-engine-domain.ts", "utf8");

test("decision engine defines canonical outcomes, reasons and audit inputs", () => {
  assert.match(source, /APPROVED/);
  assert.match(source, /PENDING_ADDITIONAL_REVIEW/);
  assert.match(source, /REVOKED/);
  assert.match(source, /reason/);
  assert.match(source, /ruleVersion/);
  assert.match(source, /inputReferences/);
});

test("decision engine validates unknown outcomes", () => {
  assert.match(source, /Unknown decision state/);
  assert.match(source, /DECISION_STATES\.includes/);
});
