# LATER-OWNER-012 — Worker Signed-Out Dashboard Redirect

Status: **RESOLVED — OWNER PASS — 5 AUGUST 2026**

Reported: 5 August 2026

Resolved and owner-retested: 5 August 2026

Area: M1.04 subunit 2 owner hard test, signed-out fixed-role routing.

Tested local commit where the defect was observed:

```text
48c406baba404771e508819bf787d084a3a74509
```

Repair pull request:

```text
#25
```

Repair merge commit:

```text
c100324ace9fea4495e1c4a50377a2df5d00a9ce
```

Repair head validated:

```text
15f601c52696624e5e351ecd1971ff54c311b70a
```

## Owner observation

The owner successfully:

- signed in to the Worker portal;
- opened and used the Worker dashboard;
- signed out;
- confirmed Company signed-out dashboard access redirected to Company login.

Before repair, opening the Worker dashboard link after logout displayed the global not-found boundary:

```text
Not available

The requested record could not be shown.
The identifier may be invalid, private, unavailable or no longer approved for public display.
```

Expected:

```text
/worker/dashboard
  -> /worker/login?reason=session-required
```

Observed before repair:

```text
/worker/dashboard
  -> global not-found presentation
```

Severity was **release-blocking for M1.04 subunit 2 owner acceptance**.

## Reproduction result

A browser-equivalent HTTP runtime probe confirmed:

1. the protected Worker request reached the accepted Worker login target;
2. the redirect was generated during App Router rendering;
3. the returned development payload contained the login presentation together with hidden framework boundary data;
4. the owner-visible browser state could therefore resolve to the wrong global boundary after logout even though the role/login mapping itself was correct.

The defect was not caused by an incorrect Worker login path, role mapping, database session rule or permission matrix.

## Root-cause repair

The repair adds an optimistic missing-cookie redirect in `src/proxy.ts` for all six fixed-role dashboard route families.

When the accepted authentication cookie is absent, Proxy now returns before protected App Router rendering begins:

```text
HTTP 307
Location: /<role>/login?reason=session-required
```

The Proxy response contains no protected route HTML. The fixed-role login page then renders normally.

This Proxy check is intentionally not the authorization boundary:

- it checks only whether the shared authentication cookie name is present;
- it does not read the database;
- it does not validate a token;
- it does not evaluate a role or permission grant;
- it does not derive or accept tenant or membership context;
- a stale, forged or otherwise invalid cookie continues to the accepted database-backed central authorization guard and is denied there.

The authentication cookie name is shared between the cookie service and Proxy without changing its accepted development or production value.

## Permanent regression coverage

Added:

- `scripts/smoke-signed-out-portal-redirects.mjs`;
- `tests/platform/authentication-signed-out-proxy.test.mjs`;
- `test:portal-redirects` inside the complete `npm run check` chain.

The runtime smoke starts a real Next.js development server and proves for Worker and Company:

1. signed-out dashboard request returns `307`;
2. `Location` is the exact fixed-role login target;
3. the redirect response contains no rendered HTML or not-found presentation;
4. the login target returns HTTP `200`;
5. the visible login page contains the session-required message.

The source-contract test proves:

- all six dashboard route families are covered;
- Proxy performs only a missing-cookie redirect;
- Proxy contains no database, central authorization evaluation or tenant selector;
- the central database-backed authorization service remains present and authoritative.

## Automated result

GitHub Actions run validating the exact repair candidate:

- run: `31008741872`
- job: `92315136578`
- result: **PASS**

Passed:

1. locked dependency installation;
2. complete `npm run check`;
3. all accepted authentication and authorization regressions;
4. Proxy source contracts;
5. real-runtime signed-out redirect smoke;
6. strict TypeScript and ESLint;
7. development and database runtime smoke;
8. deterministic production build;
9. deployable preview smoke;
10. release evidence generation and artifact upload.

## Owner retest result

After pulling merged `main`, restarting the application and remaining fully signed out, the owner manually opened:

```text
http://localhost:3000/worker/dashboard
```

Observed after repair:

- redirected to `/worker/login?reason=session-required`;
- Worker sign-in page displayed;
- global `Not available` presentation did not appear.

Owner result: **PASS — 5 August 2026**.

## Acceptance state

`LATER-OWNER-012` is resolved and no longer blocks the remaining owner hard-test sections.

This result accepts only the repaired signed-out Worker routing defect and Section H Worker redirect retest. M1.04 subunit 2 still requires clean shutdown, final clean synchronized Git state and final owner acceptance. M1.04 subunit 3 remains blocked until those remaining gates pass.
