import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardPath = "src/components/auth/role-dashboard.tsx";
const queuePath = "src/app/verifier/(portal)/reviews/page.tsx";

test("Verifier dashboard exposes the accepted evidence-review workspace through visible navigation", async () => {
  const [dashboard, queue] = await Promise.all([
    readFile(dashboardPath, "utf8"),
    readFile(queuePath, "utf8")
  ]);

  assert.match(
    dashboard,
    /href="\/verifier\/reviews"[\s\S]*Open evidence review queue/,
    "Verifier dashboard must expose a visible action into the review queue."
  );
  assert.match(
    queue,
    /<h1>Evidence review queue<\/h1>/,
    "Accepted verifier review route must render the evidence review queue heading."
  );
  assert.doesNotMatch(
    dashboard,
    /\/verifier\/review-queue/,
    "Obsolete verifier review-queue route must not remain in dashboard navigation."
  );
});
