# M1.04 Final Owner Acceptance — Authorization and Tenant Isolation

Status: **DONE — OWNER PASS**

Owner acceptance date: 6 August 2026

Repository: `itxsam57/hseverify`

Owner-tested commit: `56973430099171ebc48d2f4cc96887b58486167b`

Environment:

- Windows 10
- Google Chrome
- Node.js 22.23.1
- Normal Command Prompt
- Windows Developer Mode not required
- Local PGlite database
- Synthetic local Worker and Company accounts

## Accepted implementation chain

### Subunit 1 — Authorization domain and tenant schema foundation

- Pull request: `#23`
- Merge commit: `f1479f72cf189b158144cb7f6afc77623bf40489`
- Final record: `docs/testing/results/M1_04_AUTHORIZATION_FOUNDATION_FINAL_OWNER_ACCEPTANCE.md`

### Subunit 2 — Session authorization context and permission checks

- Implementation merge: `ccbcf44a4781faa85f6d0ded446dc13d38bbed27`
- Signed-out routing repair: `c100324ace9fea4495e1c4a50377a2df5d00a9ce`
- Final record: `docs/testing/results/M1_04_SESSION_AUTHORIZATION_CONTEXT_FINAL_OWNER_ACCEPTANCE.md`
- Resolved defect: `LATER-OWNER-012`

### Subunit 3 — Tenant-scoped repository/query/command guards

- Pull request: `#27`
- Merge commit: `f44d248f7da9bd815fdfbc869a3a7a374ad708e2`
- Final record: `docs/testing/results/M1_04_TENANT_SCOPED_REPOSITORY_GUARDS_FINAL_OWNER_ACCEPTANCE.md`

### Subunit 4 — Company-scope bootstrap fixtures and protected demonstration surfaces

- Implementation pull request: `#28`
- Implementation merge: `752e6cec8b7e83981cece5113748c8c48e52d52d`
- Delete repair pull request: `#32`
- Final repaired merge: `012ee75764b857345fc69499e8c19597dfceeffa`
- Final record: `docs/testing/results/M1_04_COMPANY_SCOPE_DEMONSTRATION_FINAL_OWNER_ACCEPTANCE.md`
- Resolved defect: `LATER-OWNER-016`

### Subunit 5 — Complete isolation, concurrency and rollback suite

- Implementation pull request: `#34`
- Validated branch head: `a4634d10048315923b5c3cae65e1d6f88ededbe8`
- Validated PR merge candidate: `b8312e3d46cf35fc469fc39ffe6a2190ded44b21`
- PR workflow run: `31069538170`
- PR job: `92514406257`
- PR evidence artifact: `8955146532`
- Implementation merge: `4329a591dfa7d1e7c4fca3feb5dd33c873984574`
- Implementation merged-main run: `31069783616`
- Implementation merged-main job: `92515107222`
- Pending-owner control merge: `56973430099171ebc48d2f4cc96887b58486167b`
- Final control merged-main run: `31070230847`
- Final control merged-main job: `92516468358`
- Automated result: **PASS**

## Automated acceptance

The complete fail-closed gate passed with:

1. six own-role portal allows and all thirty cross-role portal denials;
2. fixed-role protection for all eleven accepted protected endpoints;
3. signed-out pre-render redirects to each exact role login;
4. direct tenant predicates and non-enumerating missing, malformed and cross-tenant results;
5. trusted tenant, membership, account and session lock validation;
6. transactional denial after session, account, tenant, membership, active-role, membership-role and permission changes;
7. complete `0006` then `0005` rollback with preservation of M1.01–M1.03 data;
8. clean reapplication, idempotency, checksum validation and persistent PGlite close/reopen proof;
9. strict TypeScript, ESLint, development runtime, application PGlite runtime, production build and preview smoke;
10. permanent regression coverage inside the complete application gate.

## Final owner-confirmed closure

The owner completed and passed the focused final M1.04 closure against commit `56973430099171ebc48d2f4cc96887b58486167b`:

1. Local setup completed and migrations `0001` through `0006` were applied with matching checksums.
2. While fully signed out, direct navigation to `/worker/profile` opened `/worker/login?reason=session-required`.
3. Worker Profile content and the global **Not available** boundary were never exposed during that signed-out request.
4. Company password and TOTP login succeeded and the Company dashboard opened.
5. The active Company session navigated directly to `/worker/profile` and received **Access Denied** without Worker content.
6. **Return to active portal** restored the still-valid Company dashboard and session.
7. Company sign-out completed normally.
8. The development server stopped normally with `Ctrl+C`.
9. `git status --short`, `git diff --check` and the protected configuration diff were clean.
10. `git status -sb` showed synchronized `main...origin/main`.
11. `git rev-parse HEAD` matched `56973430099171ebc48d2f4cc96887b58486167b`.
12. No Administrator terminal or Windows Developer Mode was required.

## Security boundary accepted

- UI visibility is not an authorization boundary.
- Every protected request resolves one database-backed session and one fixed active role.
- Role or tenant switching inside a session is prohibited.
- Tenant identity and permissions come only from trusted server-side membership context.
- Every tenant-owned read and mutation includes tenant scope directly in SQL.
- Fetch-global-then-filter is prohibited.
- Sensitive commands revalidate authority transactionally where lifecycle or permission state can race.
- Missing and cross-tenant records are non-enumerating.
- Wildcard permissions and grant-above-authority behavior are rejected.
- Root emergency authority does not create routine Company tenant access.
- The M1.04 demonstration remains synthetic and separate from later Company business entities.

## Defect closure

- `LATER-OWNER-012`: resolved and owner accepted.
- `LATER-OWNER-016`: resolved and owner accepted.

No unresolved release-blocking M1.04 owner defect remains.

## Final decision

M1.04 — Authorization and Tenant Isolation is **DONE — OWNER PASS**.

Phase 1 progress is **4 of 12 Milestone 1 bricks DONE**.

M1.05 — Audit and Notification Foundations is now the only permitted next implementation brick.