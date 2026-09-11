import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const DASHBOARD_PATH = resolve("src/app/worker/(portal)/dashboard/page.tsx");

test("M1.11 Worker dashboard exposes a real evidence call-to-action", () => {
  const source = readFileSync(DASHBOARD_PATH, "utf8");
  assert.match(
    source,
    /href=["']\/worker\/evidence["']/,
    "the Worker dashboard qualification/evidence surface must deep-link to the real /worker/evidence workspace"
  );
  assert.match(
    source,
    /(?:Manage evidence|Manage qualifications|Qualifications and evidence)/i,
    "the dashboard link must have an explicit user-facing evidence action label"
  );
});
