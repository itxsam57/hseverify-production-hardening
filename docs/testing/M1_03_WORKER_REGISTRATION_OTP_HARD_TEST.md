# M1.03 Worker Registration and Mandatory OTP — Windows Owner Hard Test

## Gate boundary

This guide accepts only M1.03 internal subunit 2: Worker registration plus mandatory sandbox email and phone OTP verification.

Passing this guide does **not** make M1.03 DONE. Password sign-in/recovery, database-backed login sessions, staff MFA, privileged-role portals and the final cross-role denial matrix remain required.

## Environment

- Windows 10
- normal Command Prompt, not Administrator
- Node.js `v22.23.1` or current supported Node 22
- Google Chrome
- Windows Developer Mode not required
- existing `.data\postgres` must not be deleted
- use unique test email addresses and phone numbers
- do not paste local secrets or OTPs into chat

## A — Pull and clean baseline

```cmd
git checkout main
git pull --ff-only origin main
git status --short
```

PASS when `git status --short` prints nothing.

## B — Enable the local registration sandbox

Open the ignored local environment file:

```cmd
notepad .env.local
```

Keep the existing settings and add or update:

```text
HSE_AUTH_PEPPER=choose-a-stable-local-secret-with-at-least-32-characters
HSE_ENABLE_AUTH_SANDBOX=true
HSE_AUTH_SANDBOX_ACCESS_KEY=choose-a-local-sandbox-key-with-at-least-16-characters
```

Rules:

- use local test values, not production secrets;
- keep the same `HSE_AUTH_PEPPER` for the whole test;
- never commit `.env.local`;
- never paste the pepper, access key or OTP into chat.

Validate and apply the real local migration:

```cmd
npm run validate:env
npm run db:migrate
npm run db:status
```

PASS when migrations `0001`, `0002` and `0003_worker_registration_otp` are applied with matching checksums.

## C — Focused automated registration gate

```cmd
npm run test:registration-platform
```

PASS when all registration persistence, concurrency, cancellation, route, cookie, sandbox and responsive-layout tests pass with zero failures.

Expected test count for this implementation: **14 passed, 0 failed**.

## D — Run the application

```cmd
npm run dev
```

Open:

```text
http://localhost:3000/worker/register
```

If the development server chooses another port, use the URL printed in Command Prompt.

## E — Registration form validation

Without submitting real details, verify:

1. empty submission shows field validation;
2. an invalid email is rejected;
3. a phone without international `+` format is rejected;
4. a weak password is rejected;
5. mismatched passwords are rejected;
6. no page-wide horizontal overflow appears at desktop, 390px and 320px widths;
7. labels, focus, error text and buttons remain usable by keyboard.

PASS when invalid data creates no successful verification step and the form remains usable.

## F — Cancellation and restart

Use a unique test email and phone and a valid password.

1. Start registration.
2. Confirm the page moves to email verification.
3. Expand **Cancel and start registration again**.
4. Cancel the registration.
5. Confirm the browser returns to the registration form with a safe cancellation message.
6. Register again using the same test email and phone.

PASS when the same contacts can restart after cancellation and no login session or permanent Worker ID is created.

## G — Wrong-code, cooldown and recovery behavior

On the email verification step:

1. enter one incorrect six-digit code;
2. confirm the error reports the remaining attempts without exposing the correct code;
3. confirm **Send a new code** is disabled during the cooldown;
4. refresh the page and confirm the same email step remains;
5. use Back and Forward and confirm registration does not duplicate or skip a step;
6. close and reopen Chrome and return to `/worker/register`; confirm the opaque continuation cookie resumes verification;
7. after cooldown, request one new code;
8. confirm the prior code is no longer accepted.

PASS when only the latest valid challenge works and refresh/back/restart do not duplicate the account.

## H — Sandbox email delivery

From the verification page choose **Open sandbox inbox**.

1. select **Email**;
2. enter the exact registration email;
3. enter the local sandbox access key from `.env.local`;
4. open the latest delivery;
5. copy the six-digit code locally;
6. return to verification and submit it.

PASS when email verification completes once and the workflow advances only to phone verification.

Security checks:

- a wrong sandbox access key is denied;
- an unrelated destination returns no active delivery;
- reopening the consumed email delivery does not reveal it as active;
- the URL, page source and browser storage contain no account ID, password or continuation token.

## I — Sandbox phone delivery and activation

On the phone step:

1. confirm the page shows the masked phone destination;
2. open the sandbox inbox;
3. select **Phone**;
4. enter the exact international-format registration phone;
5. enter the local sandbox access key;
6. retrieve and submit the latest phone code.

PASS when:

- phone verification completes once;
- the account becomes active only after this step;
- the completion page shows a provisional `HSE-REG-*` reference;
- the page clearly says it is not the permanent Worker ID;
- refreshing the completion page remains complete;
- replaying either email or phone code cannot change state.

## J — No automatic portal session

After activation:

1. open `/worker/dashboard` directly;
2. confirm registration did not automatically sign the Worker into the portal;
3. confirm the current Worker login adapter remains separate from registration.

PASS when registration alone creates no login session.

## K — Duplicate/conflicting contact behavior

Return to `/worker/register` and try to register again using the completed account's email and/or phone.

PASS when:

- registration does not create a duplicate active account;
- the response is generic and does not expose another account's private details;
- no portal session is created.

## L — Complete application gate

Stop the development server with `Ctrl+C`, then run:

```cmd
npm run check
```

PASS only when every existing M1.01/M1.02/M1.03 gate passes, including:

- production audit with zero high-severity vulnerabilities;
- 14 Worker registration tests;
- strict TypeScript;
- ESLint with no warnings;
- normal development smoke;
- application PGlite runtime smoke;
- deterministic production build;
- portable preview where `/worker/register` returns 200 and the disabled sandbox returns 404.

## M — Disposable migration and rollback

Use a dedicated test database. Do not point this sequence at `.data\postgres`.

```cmd
set HSE_PGLITE_DATA_DIR=.data\m1-03-registration-owner-test
set HSE_RELEASE_SHA=m1-03-registration-owner-test
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true

npm run db:migrate
npm run db:status
npm run db:rollback
npm run db:status
npm run db:migrate
npm run db:status
```

Required sequence:

1. first migration applies `0001`, `0002` and `0003`;
2. first status shows all three applied with matching checksums;
3. rollback removes only `0003_worker_registration_otp` and its ledger row;
4. second status keeps `0001` and `0002` applied;
5. re-migrate applies only `0003`;
6. final status shows all three applied and checksum-valid.

Clean the temporary process variables and disposable database:

```cmd
set HSE_PGLITE_DATA_DIR=
set HSE_RELEASE_SHA=
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=

rmdir /s /q .data\m1-03-registration-owner-test
```

Do not delete `.data\postgres`.

## N — Repository integrity

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

Both commands must print nothing.

## Owner result

```text
M1.03 WORKER REGISTRATION AND OTP OWNER TEST

A Pull and clean baseline: PASS/FAIL
B Environment and migration: PASS/FAIL
C Focused registration tests: PASS/FAIL
D Development server: PASS/FAIL
E Form validation and responsive UI: PASS/FAIL
F Cancellation and same-contact restart: PASS/FAIL
G Wrong-code, cooldown and browser recovery: PASS/FAIL
H Email sandbox verification: PASS/FAIL
I Phone sandbox verification and activation: PASS/FAIL
J No automatic portal session: PASS/FAIL
K Duplicate/conflicting contact denial: PASS/FAIL
L Full npm run check: PASS/FAIL
M Disposable 0003 rollback/reapply: PASS/FAIL
N Existing database preserved: PASS/FAIL
O Git and protected configuration clean: PASS/FAIL
P No Administrator or Developer Mode requirement: PASS/FAIL

Defects found:
1.
2.

Registration subunit overall: PASS/FAIL
```

Any failure creates the next `LATER-OWNER-###` record and blocks the password sign-in/recovery subunit.
