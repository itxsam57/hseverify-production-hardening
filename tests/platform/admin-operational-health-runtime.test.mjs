import assert from "node:assert/strict";
import test from "node:test";
import { getOperationalHealthSnapshot } from "../../src/lib/admin/operational-health-service.ts";

test("M3.08 operational health reads platform aggregates through the database boundary", async () => {
  const snapshot = await getOperationalHealthSnapshot({
    async query(sql) {
      assert.match(sql, /auth_accounts/);
      assert.match(sql, /platform_audit_events/);
      assert.match(sql, /assurance_cases/);
      assert.match(sql, /assurance_frameworks/);
      return { rows: [{ users: "4", companies: "2", cases: "5", rules: "3", calibrations: "1", integrations: "0", audit_events: "9" }] };
    }
  });

  assert.deepEqual(
    {
      users: snapshot.users,
      companies: snapshot.companies,
      cases: snapshot.cases,
      rules: snapshot.rules,
      auditEvents: snapshot.auditEvents
    },
    { users: 4, companies: 2, cases: 5, rules: 3, auditEvents: 9 }
  );
});


test("M3.08 operational health reports degraded state when persistence is unavailable", async () => {
  const snapshot = await getOperationalHealthSnapshot({
    async query() {
      throw new Error("database unavailable");
    }
  });

  assert.equal(snapshot.status, "attention");
  assert.deepEqual(snapshot.warnings, ["Operational health database snapshot unavailable"]);
});


test("M3.08 operational health marks malformed aggregates as attention", async () => {
  const snapshot = await getOperationalHealthSnapshot({
    async query() {
      return { rows: [{ users: "-1", companies: "2", cases: "5", rules: "3", calibrations: "1", integrations: "0", audit_events: "9" }] };
    }
  });

  assert.equal(snapshot.status, "attention");
  assert.deepEqual(snapshot.warnings, ["users aggregate is invalid"]);
});
