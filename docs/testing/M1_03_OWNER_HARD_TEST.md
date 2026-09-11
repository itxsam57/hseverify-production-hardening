# M1.03 Windows Owner Hard Test

## Acceptance rule

Run this guide only against the merged M1.03 commit on `main`.

M1.03 remains **READY FOR OWNER TEST** until every section passes. Stop at the first failure. Record every failure as a permanent `LATER-OWNER-###` defect before repair. M1.04 must not begin until the complete owner result is PASS.

## Test environment

- Windows 10
- Normal Command Prompt, not Administrator
- Google Chrome
- Node.js 22.23.1 or another supported Node version at or above 20.9
- Developer Mode may remain OFF
- Repository: `C:\Users\arsla\hseverify`

## A. Pull the accepted commit and establish a clean baseline

```cmd
cd /d C:\Users\arsla\hseverify
git checkout main
git pull --ff-only origin main
git status --short
node -v
npm ci --no-audit --no-fund
```

Expected:

- `git status --short` prints nothing;
- Node is supported;
- install completes without `--force`;
- no Administrator or Developer Mode requirement appears.

Record the tested commit:

```cmd
git rev-parse HEAD
```

## B. Configure the isolated authentication sandbox

Create the local file:

```cmd
copy /Y .env.example .env.local
notepad .env.local
```

Set these values and save:

```text
HSE_APP_ENV=development
HSE_RELEASE_SHA=m1-03-owner-test
HSE_DEPLOYMENT_ID=m1-03-owner-test
HSE_SESSION_SECRET=m1-03-owner-session-secret-change-this-2026
HSE_AUTH_PEPPER=m1-03-owner-auth-pepper-change-this-2026
HSE_DATABASE_DRIVER=pglite
HSE_PGLITE_DATA_DIR=.data/m1-03-owner-test
DATABASE_URL=
HSE_ENABLE_AUTH_SANDBOX=true
HSE_AUTH_SANDBOX_ACCESS_KEY=m1-03-owner-sandbox-key
HSE_ENABLE_WORKER_DEMO_AUTH=false
HSE_USE_WORKER_DEMO_DATA=false
HSE_DEMO_PROFILE_IDENTITY_LOCKED=false
```

The local secret values are test-only. Never commit `.env.local`.

Prepare the database and run the automated gate:

```cmd
npm run setup:local
npm run db:status
npm run check
```

Expected:

- four migrations are applied, including `0004_authentication_completion`;
- every test, strict TypeScript check, lint, runtime smoke and production build passes;
- source configuration remains unchanged.

## C. Start the owner-test server

```cmd
npm run dev
```

Open Chrome at:

```text
http://localhost:3000
```

Keep this Command Prompt open until the browser test is complete.

## D. Worker registration and mandatory dual OTP

1. Open `/worker/register`.
2. Create a new Worker with a unique email and phone number.
3. Confirm no authenticated Worker session is created before verification.
4. Open `/worker/register/sandbox` in another tab.
5. Enter the sandbox key, email channel and exact registration email.
6. Retrieve and submit the email OTP.
7. Retrieve the phone OTP using the phone channel and exact phone destination.
8. Submit the phone OTP.
9. Confirm registration completes only after both contacts are verified.
10. Confirm an `HSE-REG` reference is described as provisional and is not presented as a permanent Worker ID.

Expected:

- OTP values are visible only through the protected sandbox page;
- each OTP works once;
- wrong codes reduce attempts;
- resend cooldown is enforced;
- refresh and Back do not bypass the current registration step;
- registration does not automatically sign the Worker in.

## E. Worker fixed-role sign-in and session behavior

1. Open `/worker/login`.
2. Sign in with the newly registered Worker.
3. Confirm the Worker Dashboard loads.
4. Refresh and confirm the session persists.
5. Open `/account/sessions` and confirm the current session is listed.
6. Open a second Chrome profile or Incognito window and sign in again.
7. Confirm both sessions are listed.
8. Revoke the other session.
9. Refresh the revoked browser and confirm it is denied and returned to Worker login.
10. Sign out the remaining session and confirm the cookie no longer grants dashboard access.

Expected:

- the cookie contains no visible role or account details;
- revocation takes effect on the next protected request;
- only sessions owned by the signed-in account can be revoked.

## F. Worker lockout and password recovery

1. Enter an incorrect Worker password repeatedly until the account is temporarily locked.
2. Confirm the error does not reveal account existence before valid credential proof.
3. Open `/auth/recover?portal=worker`.
4. Request recovery for the Worker email.
5. Retrieve the password-reset email OTP from `/worker/register/sandbox`.
6. Submit the OTP and a new strong password.
7. Attempt to reuse the same OTP and confirm rejection.
8. Confirm all previously active Worker sessions are revoked.
9. Sign in using the new password.

Expected:

- recovery requests and reset attempts are rate-limited before expensive hashing;
- reset OTP and recovery flow are one-time;
- successful reset clears lockout and revokes every old session.

## G. First-Root sandbox bootstrap

1. Sign out completely.
2. Open `/auth/sandbox/bootstrap-root`.
3. Enter a unique Root email and the sandbox access key.
4. Open the generated invitation path.
5. Create the Root display name and strong password.
6. Add the displayed TOTP secret or URI to an authenticator application.
7. Enter a current six-digit authenticator code.
8. Confirm enrollment completes and redirects to `/root/login`.
9. Sign in using Root email, password and a fresh TOTP code.

Expected:

- Root bootstrap works only while no Root assignment exists;
- a second first-Root bootstrap is rejected;
- password setup alone cannot activate the Root account;
- the same TOTP counter cannot be reused.

## H. Invitation-only staff enrollment

From `/root/staff`, create separate invitations for:

- Company;
- Assessor;
- Verifier;
- Administrator.

For each invitation:

1. Open the single-use invitation path in a separate browser context.
2. Create the profile and strong password.
3. enroll TOTP;
4. complete enrollment;
5. confirm the invitation cannot be reused;
6. sign in through that role's exact login route with password and TOTP.

Required routes:

```text
/company/login
/assessor/login
/verifier/login
/admin/login
/root/login
```

Expected:

- staff accounts cannot self-register;
- every non-Worker role requires TOTP;
- Administrator can invite only Company, Assessor and Verifier;
- Root may invite all supported staff roles;
- expired, cancelled or abandoned invitations do not permanently block a replacement invitation.

## I. Portal isolation and copied-URL denial

While signed in to each role, manually open every other role's dashboard URL.

```text
/worker/dashboard
/company/dashboard
/assessor/dashboard
/verifier/dashboard
/admin/dashboard
/root/dashboard
```

Expected:

- the matching dashboard opens;
- every mismatched dashboard goes to `/access-denied`;
- no data from the other portal is rendered before denial;
- no role-switch control exists;
- access to another portal requires full sign-out and separate login.

Also test unauthenticated direct access to each dashboard in Incognito.

Expected:

- each route redirects to its own role-specific login page.

## J. Session and stale-action denial

1. Sign in to a staff portal.
2. Open its staff or session form in two tabs.
3. Revoke or sign out the session from one tab.
4. Submit the previously opened form from the stale tab.
5. Confirm the protected action is denied and no mutation occurs.
6. Repeat after password reset.

Expected:

- route guards and server actions both re-check the database session;
- a stale page cannot perform a privileged action after revocation.

## K. Migration rollback and reapply

Stop the development server with `Ctrl+C`, then run:

```cmd
npm run db:status
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true
npm run db:rollback
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=
npm run db:status
npm run db:migrate
npm run db:status
npm run check
```

The acknowledgement variable is required only for a local/test destructive rollback. Clear it immediately after the rollback command and never persist it in `.env.local`.

Expected:

- rollback removes only migration `0004_authentication_completion`;
- migrations `0001`, `0002` and `0003` remain;
- the acknowledgement variable is cleared before migration reapply;
- reapply restores `0004`;
- the complete automated gate passes again.

## L. Responsive and accessibility checks

Restart the server:

```cmd
npm run dev
```

Check Worker registration, every login page, recovery, staff enrollment, sessions and access-denied pages at:

- normal desktop 100%;
- 860 × 900;
- 768 × 900;
- 390 × 844;
- 320 × 700;
- desktop zoom 125%, 150% and 200%.

Expected:

- no page-wide horizontal overflow;
- labels remain associated with controls;
- keyboard focus remains visible;
- status and error messages are announced and readable;
- actions remain contained and usable;
- secrets are not printed outside their protected enrollment/sandbox surfaces.

## M. Final clean shutdown

Stop the server with `Ctrl+C`, then run:

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

Expected:

- tracked project configuration has no changes;
- only the intentionally local, ignored `.env.local` and database directory may exist;
- both commands print no tracked differences.

## Final owner result

```text
M1.03 AUTHENTICATION AND PORTAL ISOLATION OWNER TEST

Commit tested:
Operating system: Windows 10
Node version:
Browser: Google Chrome
Terminal: Normal Command Prompt
Developer Mode: OFF/ON

A Pull/install and clean baseline: PASS
B Sandbox configuration and migrations: PASS
C Full npm run check: PASS
D Worker dual-OTP registration: PASS
E Worker sign-in and session management: PASS
F Lockout and password recovery: PASS
G First-Root bootstrap and TOTP: PASS
H Invitation-only staff enrollment: PASS
I Six fixed-role logins: PASS
J Cross-role and copied-URL denial: PASS
K Stale/revoked action denial: PASS
L Password-reset all-session revocation: PASS
M Migration rollback and reapply: PASS
N Responsive/accessibility matrix: PASS
O Clean shutdown and Git state: PASS
P No Administrator or Developer Mode requirement: PASS

Defects found:
None

Overall: PASS
```
