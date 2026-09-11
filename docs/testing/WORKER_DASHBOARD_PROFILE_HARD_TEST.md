# Worker Dashboard and Worker Profile — Owner Hard Test

## Purpose

This is the mandatory manual acceptance test for the two merged Worker Portal build units:

1. Worker Dashboard foundation.
2. Worker Profile and onboarding continuation.

Passing automated CI proves the code installs, tests, typechecks, lints and production-builds. It does **not** prove that the workflow behaves correctly on the owner's device. Do not start the next feature brick until this checklist is completed or the owner explicitly records a decision to continue with known defects.

## What is expected to work in this test

- Worker-only login using the temporary environment-gated demo adapter.
- Worker Dashboard route protection.
- Worker Portal navigation.
- Exit Portal and Sign Out as two different actions.
- Worker ID copy.
- Worker Profile personal, contact and professional sections.
- Save changes.
- Save and continue.
- First-incomplete-step onboarding routing.
- Profile completion reflected on the dashboard.
- Profile data retained after refresh and server restart.
- Field validation.
- Stale-form conflict protection.
- Sensitive identity-field correction-request behavior when the test flag is enabled.
- Loading and recoverable error pages.
- Mobile and keyboard usability.

## What is deliberately not expected to work yet

These are not excuses or forgotten features; they are recorded in `docs/bookmarks/LATER.md`:

- public Worker registration;
- real email and phone OTP;
- Company, Reviewer, Assessor and Admin portals;
- identity-document uploads;
- production database;
- production notifications/email;
- qualification, experience, employment and skill workflows;
- assessments, interviews, credentials and payments.

Do not mark one of these as a regression in this test unless the current UI falsely presents it as working.

---

## Part A — Prepare the test environment

### A1. Install prerequisites

Use a computer with:

- Git;
- Node.js 24 recommended, or Node.js 20.9 or newer;
- npm;
- a current Chrome, Edge, Firefox or Safari browser.

### A2. Clone the exact `main` branch

Windows PowerShell or Command Prompt:

```bash
git clone https://github.com/itxsam57/hseverify.git
cd hseverify
git checkout main
git pull origin main
```

Confirm the latest commit includes the Worker Profile merge:

```bash
git log -1 --oneline
```

Expected: the history includes `Build Worker Profile and onboarding continuation (#3)` or a later approved commit.

### A3. Install locked dependencies

```bash
npm ci
```

Expected:

- command exits successfully;
- no manual package changes are required;
- `package-lock.json` is not modified.

### A4. Create local environment configuration

Windows:

```bash
copy .env.example .env.local
notepad .env.local
```

macOS/Linux:

```bash
cp .env.example .env.local
```

Use local test-only values similar to:

```dotenv
HSE_SESSION_SECRET=local-test-secret-change-this-to-more-than-32-characters
HSE_ENABLE_WORKER_DEMO_AUTH=true
HSE_WORKER_DEMO_EMAIL=worker@example.com
HSE_WORKER_DEMO_PASSWORD=LocalTestPassword123!
HSE_WORKER_DEMO_NAME=Test Worker
HSE_WORKER_DEMO_ID=HSE-WRK-TEST-0001
HSE_USE_WORKER_DEMO_DATA=true
HSE_PROFILE_STORAGE_DIR=
HSE_DEMO_PROFILE_IDENTITY_LOCKED=false
```

Rules:

- never commit `.env.local`;
- use no real worker information;
- keep `HSE_PROFILE_STORAGE_DIR` blank for the default local `.data/worker-profiles` directory;
- use a test password only.

### A5. Run the complete automated gate first

```bash
npm run check
```

Expected result:

1. Worker route/role/profile-persistence manifest passes.
2. Five Worker Profile domain tests pass.
3. TypeScript passes.
4. ESLint passes.
5. Next.js production build passes.

If this command fails, stop the manual test and provide the complete terminal error.

### A6. Start the app

```bash
npm run dev
```

Open:

```text
http://localhost:3000/worker/login
```

Keep the terminal visible so runtime errors can be captured.

---

## Part B — Authentication and portal-isolation tests

### Test B1 — Protected route without login

1. Open a private/incognito browser window.
2. Go directly to `http://localhost:3000/worker/dashboard`.

Expected:

- you are redirected to `/worker/login`;
- no Worker Dashboard data flashes before the redirect;
- no error stack appears.

Record: PASS / FAIL.

### Test B2 — Profile route without login

1. Still signed out, open `http://localhost:3000/worker/profile`.

Expected:

- redirect to `/worker/login`;
- no profile data is exposed.

Record: PASS / FAIL.

### Test B3 — Invalid credentials

1. Enter the correct email and an incorrect password.
2. Submit.

Expected:

- login is rejected;
- message is neutral and does not expose internal role/session details;
- password is not displayed;
- the page does not navigate to the dashboard.

Record: PASS / FAIL.

### Test B4 — Valid Worker login

1. Enter the values from `.env.local`.
2. Submit once.

Expected:

- one login action occurs;
- route changes to the Worker Portal;
- the dashboard renders without manual refresh;
- role label says Worker Portal;
- there is no Switch Role control.

Record: PASS / FAIL.

### Test B5 — Cross-portal route probing

While logged into Worker Portal, manually open:

```text
http://localhost:3000/company
http://localhost:3000/reviewer
http://localhost:3000/assessor
http://localhost:3000/admin
```

Expected for the current build:

- no route displays Worker data inside another portal;
- unimplemented portals return not-found/neutral behavior;
- no role elevation or alternate dashboard appears.

Record each route separately.

### Test B6 — Exit Portal versus Sign Out

1. In the Worker profile menu, choose **Exit portal**.
2. Confirm you reach the public site.
3. Reopen `/worker/dashboard`.

Expected:

- the Worker session still exists after Exit Portal;
- dashboard opens without logging in again.

Then:

4. Choose **Sign out**.
5. Reopen `/worker/dashboard`.

Expected:

- you are redirected to Worker login;
- the session is gone.

Record: PASS / FAIL for both behaviors.

---

## Part C — Worker Dashboard tests

Log in again before continuing.

### Test C1 — Dashboard content and route behavior

1. Open `/worker/dashboard`.
2. Click every visible active control.

Expected:

- route changes update content immediately;
- no manual refresh is required;
- no active button is decorative;
- unavailable modules are not presented as working actions.

Record every dead or misleading control as a separate defect.

### Test C2 — Worker ID copy

1. Click **Copy Worker ID**.
2. Paste into a plain text field.

Expected:

- the exact configured Worker ID is copied;
- an accessible success confirmation appears;
- repeated clicks do not alter the value.

Record: PASS / FAIL.

### Test C3 — Notification deep links

1. Open the notification menu.
2. Click each demonstration notification.

Expected:

- each item opens the exact authorized dashboard section;
- content updates without refresh;
- the link does not open another role's portal.

Record each notification separately.

### Test C4 — Dashboard/profile connection

1. Note the displayed name and profile-completion percentage.
2. Continue to the profile tests below.
3. Return to the dashboard after saving profile data.

Expected:

- dashboard name and completion come from the committed profile;
- values do not remain permanently hard-coded;
- no manual browser refresh should be needed after normal navigation. If a refresh is needed, record a release-blocking defect.

---

## Part D — Worker Profile workflow tests

### Test D1 — Empty profile and first incomplete step

Use a clean profile store by stopping the server and deleting only the local test directory:

Windows:

```bash
rmdir /s /q .data\worker-profiles
```

PowerShell:

```powershell
Remove-Item -Recurse -Force .data\worker-profiles -ErrorAction SilentlyContinue
```

macOS/Linux:

```bash
rm -rf .data/worker-profiles
```

Restart `npm run dev`, log in and open:

```text
http://localhost:3000/worker/onboarding
```

Expected:

- onboarding redirects to the first incomplete profile section;
- completion begins at the honest empty value;
- the page does not invent completed profile data.

Record: PASS / FAIL.

### Test D2 — Required-field validation

1. Leave required fields blank.
2. Click **Save changes**.

Expected:

- save is rejected;
- field-specific errors appear;
- entered values remain where applicable;
- no profile version is committed for invalid data;
- the page does not crash.

Record: PASS / FAIL.

### Test D3 — Personal details save

Enter clearly fake test data:

- legal first and last name;
- date of birth representing an adult;
- nationality;
- country of residence;
- primary language;
- optional preferred name.

Click **Save and continue**.

Expected:

- action shows a saving state;
- duplicate clicks are prevented while pending;
- success message appears;
- route advances to Contact and address;
- personal values remain after returning to the section.

Record: PASS / FAIL.

### Test D4 — Contact validation

Test invalid values first:

- invalid country code;
- phone containing letters;
- incomplete address/city.

Expected:

- field errors appear;
- invalid data is not committed.

Then enter valid fake test values and click **Save and continue**.

Expected:

- route advances to Professional overview;
- saved values remain after navigation.

Record invalid and valid paths separately.

### Test D5 — Professional section

1. Enter occupation/trade.
2. Enter years of experience.
3. Choose employment status and relocation preference.
4. Save.

Expected:

- invalid years or required selections are rejected;
- valid data saves;
- completion reaches 100% only after every required field across all sections is committed.

Record: PASS / FAIL.

### Test D6 — Submit complete profile

1. Click **Submit profile** only after completion shows 100%.

Expected:

- incomplete profiles cannot submit;
- complete profile submits once;
- repeated clicking does not create multiple submissions;
- status becomes Submitted;
- audit history contains the submission event.

Record: PASS / FAIL.

### Test D7 — Persistence after refresh

1. Refresh the browser several times.
2. Navigate away and back.
3. Close the browser and reopen it.

Expected:

- committed profile values remain;
- no section resets to empty;
- profile completion remains correct.

Record: PASS / FAIL.

### Test D8 — Persistence after server restart

1. Stop the server with `Ctrl+C`.
2. Start it again with `npm run dev`.
3. Log in and open `/worker/profile`.

Expected:

- committed values survive the restart;
- no duplicate profile is created;
- audit/version history remains.

Record: PASS / FAIL.

### Test D9 — Dashboard updates from profile

1. Return to `/worker/dashboard`.

Expected:

- preferred/legal display name reflects the saved profile rule;
- profile completion reflects committed fields;
- navigation works without manual refresh.

Record: PASS / FAIL.

---

## Part E — Concurrency and history tests

### Test E1 — Stale-form overwrite prevention

1. Open `/worker/profile` in two tabs: Tab A and Tab B.
2. In Tab A, change and save an editable field.
3. Without refreshing Tab B, change another value and save.

Expected:

- Tab B is rejected as a version conflict;
- Tab B does not overwrite Tab A;
- the user receives a safe reload/refresh instruction;
- after refresh, Tab A's committed value remains.

This is release-blocking if stale data overwrites newer data.

Record: PASS / FAIL.

### Test E2 — Audit history

1. Save at least one change in each section.
2. Submit the profile.
3. Review recent profile activity.

Expected:

- creation/save/submission events appear;
- version transitions are logical;
- entries identify changed field names, not duplicate sensitive values;
- refreshing does not create extra audit events by itself.

Record: PASS / FAIL.

---

## Part F — Sensitive-field correction test

Do this only after a complete test profile exists.

### Test F1 — Enable identity-field lock

1. Stop the server.
2. Change `.env.local`:

```dotenv
HSE_DEMO_PROFILE_IDENTITY_LOCKED=true
```

3. Restart `npm run dev`.
4. Log in and open Personal details.

Expected:

- legal name, date of birth and nationality are visibly locked;
- normal profile saving cannot replace those active values;
- other non-sensitive profile fields remain editable.

Record: PASS / FAIL.

### Test F2 — Submit correction request

1. Open the correction-request form.
2. First submit the same existing values.

Expected:

- request is rejected because nothing changed.

Then:

3. Enter proposed changed values and a clear reason.
4. Submit.

Expected:

- a pending correction request is created;
- active verified/profile values do not change immediately;
- request appears in history/status;
- submitting another request must not silently replace the pending one.

Record each path separately.

---

## Part G — Responsive and accessibility test

### Test G1 — Mobile layout

Test browser widths near:

- 320 px;
- 375 px;
- 768 px;
- desktop width.

Expected:

- no horizontal page loss for core controls;
- fields and buttons remain usable;
- navigation remains reachable;
- messages do not cover controls;
- no text is cut off in a way that prevents use.

Record screenshots of failures.

### Test G2 — Keyboard-only use

Without using a mouse:

1. Tab through login.
2. Log in.
3. Navigate to profile.
4. Edit a field.
5. Save.
6. Open notification and profile menus.
7. Sign out.

Expected:

- visible focus indicator;
- logical focus order;
- every active control is reachable;
- no keyboard trap;
- skip link reaches main content.

Record: PASS / FAIL.

### Test G3 — Browser zoom

Test at 200% zoom.

Expected:

- content remains operable;
- buttons and form labels remain understandable;
- no required control disappears.

Record: PASS / FAIL.

---

## Part H — Error and corruption resistance

### Test H1 — Read-only/unavailable storage simulation

Use a temporary invalid storage path only for this test, then restore it:

```dotenv
HSE_PROFILE_STORAGE_DIR=<a path the current user cannot write to>
```

Restart the server and attempt a profile save.

Expected:

- user receives a safe storage/configuration error;
- no stack trace or filesystem path is shown in the browser;
- entered data is not falsely reported as saved;
- existing committed data is not corrupted.

Record: PASS / FAIL and terminal error.

### Test H2 — Browser console and server terminal

During all tests, check:

- browser developer console;
- Network tab for failed requests;
- server terminal.

Expected:

- no repeated unhandled exceptions;
- no secrets, passwords or profile record contents in client logs;
- no failed navigation requiring manual refresh.

Record all unexpected output.

---

## Part I — Final acceptance record

Use this template in chat after testing:

```text
HSE VERIFY OWNER HARD TEST
Commit tested:
Date/time:
Operating system:
Browser and version:
Screen/device:

Automated npm run check: PASS / FAIL
B Authentication/isolation: PASS / FAIL
C Dashboard: PASS / FAIL
D Profile workflow: PASS / FAIL
E Concurrency/history: PASS / FAIL
F Sensitive correction: PASS / FAIL
G Mobile/accessibility: PASS / FAIL
H Failure handling: PASS / FAIL

Release-blocking defects:
1.
2.

Other defects:
1.
2.

Owner decision:
[ ] Accepted — continue roadmap
[ ] Rejected — fix defects before continuing
[ ] Continue with recorded defects (explicit exception)
```

Every reported defect must be reproduced, added to `docs/bookmarks/LATER.md` as an Owner defect, fixed on an isolated branch, pass automated CI, and be retested before the next canonical feature brick begins.
