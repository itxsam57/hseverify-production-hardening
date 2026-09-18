import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { PrivacyOperationsService } = loadTs("src/lib/privacy/privacy-operations-service.ts");

test("privacy listing cannot cross worker boundary before repository access", async () => {
  const service = new PrivacyOperationsService({
    listRequests: async () => {
      throw new Error("repository must not be reached");
    },
    listAccommodations: async () => {
      throw new Error("repository must not be reached");
    },
  });

  await assert.rejects(() => service.ensureWorkerAccess({ workerId: "worker-a", ownerWorkerId: "worker-b" }));
});

test("privacy creation cannot write outside a tenant worker boundary", async () => {
  let wrote = false;
  const service = new PrivacyOperationsService({
    createRequest: async () => { wrote = true; },
    addAccommodation: async () => { wrote = true; },
  });

  await assert.rejects(() => service.request({ requestId: "r1", tenantId: "", workerId: "worker-a", type: "access" }));
  await assert.rejects(() => service.accommodation({ id: "a1", tenantId: "", workerId: "worker-a", type: "screen" }));
  assert.equal(wrote, false);
});
