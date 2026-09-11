# M1.04 Authorization Foundation — Owner Platform Gate PASS

Status: **OWNER PASS**

Owner test date: 4 August 2026

Environment:

- Windows 10
- Normal Command Prompt
- Repository: `C:\Users\arsla\hseverify`
- Branch: `main`

Command:

```cmd
npm run test:authorization-platform
```

Observed:

- 9 tests executed;
- 9 passed;
- 0 failed;
- 0 cancelled;
- 0 skipped;
- duration approximately 57 seconds.

Owner-confirmed passing boundaries:

1. One Company account has one unambiguous current tenant context.
2. SQL tenant permission ceiling exactly matches the accepted role matrix.
3. Migration `0005_authorization_tenant_isolation` creates all tenant and membership security boundaries.
4. Predictable or malformed tenant and membership identifiers are rejected.
5. Only accounts assigned the Company portal role can hold tenant membership.
6. Contradictory tenant and membership lifecycle state is rejected.
7. Wildcard, role-mismatched, grant-above-ceiling and duplicate permission overrides are rejected.
8. Migration `0005` rolls back independently and reapplies cleanly in the automated regression.
9. Authorization source keeps permission and tenant boundaries explicit.

Verdict boundary:

Section D — focused migrated-database authorization gate — **PASS**.

This does not yet accept the complete application gate, manual owner rollback/reapply, existing authentication regression or final clean Git state. M1.04 subunit 1 remains **OWNER TEST IN PROGRESS**.

Next permitted owner action:

```cmd
npm run check
```
