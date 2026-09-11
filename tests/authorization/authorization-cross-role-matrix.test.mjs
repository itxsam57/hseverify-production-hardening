import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTAL_ENTRY_PERMISSIONS,
  authorizePortalEntry,
  resolveSessionAuthorizationContext
} from "../../.authorization-test-dist/authorization/authorization-context-domain.js";

const NOW = "2026-08-06T03:30:00.000Z";
const ROLES = ["worker", "company", "assessor", "verifier", "admin", "root"];

function resolution(activeRole) {
  return resolveSessionAuthorizationContext({
    now: NOW,
    snapshot: {
      sessionId: `session_final_matrix_${activeRole}`,
      accountId: `account_final_matrix_${activeRole}`,
      activeRole,
      accountStatus: "active",
      email: `${activeRole}@example.com`,
      displayName: `${activeRole} matrix account`,
      roleAssigned: true,
      createdAt: "2026-08-06T02:30:00.000Z",
      lastSeenAt: "2026-08-06T03:25:00.000Z",
      expiresAt: "2026-08-06T11:30:00.000Z",
      revokedAt: null,
      tenantMembership: null
    }
  });
}

test("all six fixed portal roles allow only their own direct endpoint boundary", () => {
  assert.deepEqual(Object.keys(PORTAL_ENTRY_PERMISSIONS), ROLES);
  assert.equal(new Set(Object.values(PORTAL_ENTRY_PERMISSIONS)).size, ROLES.length);

  for (const activeRole of ROLES) {
    const resolved = resolution(activeRole);
    assert.equal(resolved.allowed, true, `${activeRole} session must resolve`);

    for (const expectedRole of ROLES) {
      const decision = authorizePortalEntry({
        resolution: resolved,
        expectedRole
      });

      if (activeRole === expectedRole) {
        assert.equal(decision.allowed, true, `${activeRole} own portal`);
        assert.equal(decision.principal.activeRole, activeRole);
        assert.equal(decision.principal.sessionId, `session_final_matrix_${activeRole}`);
      } else {
        assert.deepEqual(
          decision,
          {
            allowed: false,
            reason: "role_mismatch",
            auditContext: {
              sessionId: `session_final_matrix_${activeRole}`,
              accountId: `account_final_matrix_${activeRole}`,
              activeRole
            }
          },
          `${activeRole} must not enter ${expectedRole}`
        );
      }
    }
  }
});
