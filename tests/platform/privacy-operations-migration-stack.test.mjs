import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("privacy migration history stays immutable and worker scope evolves additively", async () => {
 const original=await readFile("database/migrations/0057_privacy_accessibility_operations.up.sql","utf8");
 const repair=await readFile("database/migrations/0064_worker_owned_privacy_scope.up.sql","utf8");
 assert.doesNotMatch(original,/tenant_id/);
 assert.match(repair,/ADD COLUMN IF NOT EXISTS tenant_id TEXT/);
 assert.match(repair,/privacy_requests/);
 assert.match(repair,/accessibility_accommodations/);
 assert.match(repair,/retention_jobs/);
});
