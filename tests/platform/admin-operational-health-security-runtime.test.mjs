import assert from "node:assert/strict";
import test from "node:test";
import { getOperationalHealthSnapshot } from "../../src/lib/admin/operational-health-service.ts";

test("M3.08 operational health only returns aggregate operational data from the runtime service boundary", async () => {
  const snapshot = await getOperationalHealthSnapshot({
    async query() {
      return {
        rows: [{
          users: "2",
          companies: "1",
          cases: "3",
          rules: "4",
          calibrations: "5",
          integrations: "0",
          audit_events: "6"
        }]
      };
    }
  });

  assert.deepEqual(
    {
      users: snapshot.users,
      companies: snapshot.companies,
      cases: snapshot.cases,
      rules: snapshot.rules,
      calibrations: snapshot.calibrations,
      integrations: snapshot.integrations,
      auditEvents: snapshot.auditEvents
    },
    {
      users: 2,
      companies: 1,
      cases: 3,
      rules: 4,
      calibrations: 5,
      integrations: 0,
      auditEvents: 6
    }
  );

  assert.equal("privateRecords" in snapshot, false);
  assert.equal("tenantMembers" in snapshot, false);
});
