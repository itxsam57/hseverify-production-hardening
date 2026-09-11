# M1.04 Session Authorization Context — Merged, Owner Gate Pending

Status: **IMPLEMENTATION MERGED — OWNER TEST PENDING**

Merged: 5 August 2026

Repository: `itxsam57/hseverify`

Pull request:

```text
#24
```

Implementation head:

```text
c1707fb072fd133abffd834fc65a764e5befffe2
```

Merge commit:

```text
ccbcf44a4781faa85f6d0ded446dc13d38bbed27
```

Final pre-merge automated gate:

- GitHub Actions run: `30978183970`
- job: `92216772217`
- result: **PASS**

Passed:

1. locked dependency installation;
2. complete `npm run check`;
3. authorization source/domain/migrated-database gates;
4. every accepted M1.01–M1.03 regression;
5. strict TypeScript and ESLint;
6. development and database-backed runtime smoke;
7. deterministic production build;
8. deployable preview smoke;
9. release evidence generation and artifact upload.

## Merged boundary

- trusted session/account/role lifecycle resolution;
- authoritative session-token-to-context SQL;
- one server-derived Company tenant membership context;
- central platform, portal and current-tenant permission guards;
- non-enumerating denial routing and security-event recording;
- fixed-role portal integration through the central guard;
- permanent context, exact SQL and source-contract tests;
- clock-independent authentication invitation regressions;
- implementation and Windows owner-test documentation.

## Boundary not accepted yet

This merge does not itself owner-accept subunit 2.

It does not claim:

- tenant-owned repository/query/command enforcement;
- protected Company business surfaces;
- complete cross-tenant endpoint/concurrency testing;
- completion of M1.04.

## Next permitted action

Run only:

```text
docs/testing/M1_04_SESSION_AUTHORIZATION_CONTEXT_HARD_TEST.md
```

against merged `main`.

Do not begin M1.04 subunit 3 until every owner section passes, evidence is recorded, the repository is clean and synchronized, and no release-blocking owner defect remains.
