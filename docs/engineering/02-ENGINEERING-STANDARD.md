# 02 — Engineering Standard

## Preserve before improving

Treat existing working behaviour as an asset. Make the smallest coherent change that fully solves the task.

Do not perform opportunistic rewrites, broad renaming, architecture replacement, dependency migration, styling redesign, or database reshaping during an unrelated feature or bug fix.

Refactoring is allowed when it is necessary to remove the actual root cause, but the developer must explain:

- why the current structure prevents a reliable fix;
- what scope is changing;
- what behaviour must remain identical;
- what tests protect the refactor.

## Root-cause standard

Do not patch symptoms repeatedly. For a defect:

1. reproduce it;
2. identify the failing boundary;
3. trace state, data, permissions, and lifecycle;
4. fix the smallest root cause;
5. add a regression test;
6. run affected checks;
7. run the full gate before handoff.

## Code-quality rules

- Use the repository's language and framework conventions.
- Prefer explicit types and validated boundaries.
- Keep functions and components focused.
- Avoid hidden global state.
- Keep server, client, data, and authorization responsibilities clear.
- Handle errors deliberately.
- Do not swallow exceptions without a recovery or reporting path.
- Do not leave debug code, temporary bypasses, hard-coded test users, or secret material.
- Do not introduce duplicate utilities when a reliable one exists.
- Remove abandoned code created by the current task.
- Keep changes reviewable.

## State and persistence

Visible success is not enough. Verify that:

- saved data survives refresh or restart where expected;
- failed operations do not leave partial state;
- duplicate submission or retry is safe;
- loading, success, empty, error, retry, and permission-denied states are handled;
- server truth is not replaced by stale client assumptions;
- records retain correct owner, tenant, role, and relationship links;
- asynchronous operations cannot silently disappear.

## External services

Wrap external providers behind clear boundaries where practical. Test:

- success;
- invalid credentials;
- timeout;
- rate limit;
- temporary unavailability;
- duplicate webhook or callback;
- retry;
- partial completion;
- provider response changes.

Never silently claim an external action succeeded before confirmation.

## Database and migrations

- Migrations must be reviewable and reversible where the platform supports it.
- Avoid destructive changes without explicit approval and backup strategy.
- Validate old and new records.
- Preserve tenant and ownership relationships.
- Test migration application in a non-production environment.
- Do not let tests point to production.

## Definition of done

The task is not done until:

- implementation is complete;
- applicable tests exist;
- all required automated checks pass;
- no test was weakened;
- the preview or runnable build is available;
- the manual handoff is generated;
- known limitations are disclosed.


---
