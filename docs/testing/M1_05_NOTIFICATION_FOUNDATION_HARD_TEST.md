# M1.05 Subunit 3 — Persisted Notifications Owner Hard Test

## Purpose

This handoff covers only behavior automation cannot honestly replace: the visible persisted notification bell/list, immediate read-state updates, framework navigation, refresh/restart persistence, responsive presentation and fixed-role portal denial.

Do not start Subunit 4 until every required step below passes.

## A. Synchronize the merged build

Run in a normal Command Prompt:

```cmd
cd /d C:\Users\arsla\hseverify
git checkout main
git pull --ff-only origin main
npm ci
```

Required:

- checkout remains on `main`;
- pull succeeds without a merge commit;
- locked dependencies install successfully.

## B. Apply and inspect migrations

```cmd
npm run setup:local
npm run db:status
```

Required:

- migrations `0001` through `0009` are applied;
- `0009_persisted_notifications` is applied;
- every checksum matches.

## C. Focused notification gate

```cmd
npm run check:notifications
npm run test:notifications
npm run test:notification-platform
```

All commands must exit successfully.

## D. Complete regression gate

```cmd
npm run check
```

The complete gate must pass. Do not use `npm audit fix --force`.

## E. Start the local app

```cmd
npm run dev
```

Leave this Command Prompt running while performing the visible checks below.

## F. Worker persisted-notification workflow

1. Sign in with the already accepted local Worker account.
2. Open `/worker/notifications`.
3. Confirm the page visibly identifies the current portal and shows a real empty/list state rather than a stuck loader or blank page.
4. Click **Create persisted test notification** once.
5. Required after the action completes:
   - a success message says the real outbox worker projected the test notification;
   - exactly one new `Notification foundation ready` record appears;
   - it is marked **Unread**;
   - the header bell unread count increases;
   - the Worker dashboard notification metric/recent list reflects the same persisted record without a manual hard refresh.
6. Refresh the page. The notification and unread state must remain.
7. Click **Mark read** on that record.
8. Required:
   - the record changes to **Read**;
   - the bell unread count decreases immediately;
   - refreshing the page keeps it read.
9. Click **Create persisted test notification** again.
10. Required:
    - a second new notification is created successfully;
    - the first notification is not overwritten or duplicated;
    - the new unread count is correct.
11. Click **Open** on the new notification.
12. Required:
    - it opens the real Worker dashboard through normal application navigation;
    - it does not open another role's portal;
    - returning to Notifications shows that opened notification as read.

## G. Worker cross-role denial

While still signed in only as the Worker, manually enter:

```text
/company/notifications
```

Required:

- Company notification content is never rendered;
- the Worker session does not gain Company authority;
- there is no role-switch control or mixed-role notification state.

Return to `/worker/notifications` and confirm the Worker notifications are still intact.

## H. Company visible scope workflow

1. Sign out of the Worker Portal normally.
2. Sign in with the already accepted local Company account that has its active Company tenant membership.
3. Open `/company/notifications`.
4. Click **Create persisted test notification**.
5. Required:
   - exactly one new Company notification appears for that signed-in Company portal;
   - the Company bell count updates;
   - no Worker notification appears in this list;
   - **Open** returns to the real Company dashboard, never the Worker or another portal.
6. Mark the Company notification read and confirm the count updates without manual refresh.
7. Refresh the page and confirm the read state persists.

Cross-tenant database isolation is already covered by the permanent two-tenant automated suite; do not invent a second tenant manually for this owner test.

## I. Responsive and keyboard check

On either accepted notification page:

1. Narrow the browser to a phone-like width.
2. Confirm notification copy and actions reflow vertically without page-breaking horizontal overflow.
3. Use the keyboard to reach the notification bell, notification links/buttons, **Open**, **Mark read**, and the test-fixture control.
4. Confirm focus remains visible and controls can be activated from the keyboard.

## J. Restart persistence

1. Stop the development server with `Ctrl+C` and allow normal shutdown.
2. Start it again:

```cmd
npm run dev
```

3. Sign back into one of the accounts tested above if the session requires it.
4. Open its notification page.

Required:

- previously created notifications still exist;
- previously read records remain read;
- unread count still matches persisted state.

Stop the server normally with `Ctrl+C` after this check.

## K. Clean closure

```cmd
git status -sb
git diff --check
git diff -- .env.example package.json package-lock.json next.config.ts tsconfig.json
git rev-parse HEAD
git rev-parse origin/main
```

Required:

- no tracked working-tree changes;
- no whitespace errors;
- no unexpected protected-config diff;
- local `HEAD` equals `origin/main`.

## PASS rule

Report **PASS** only if every command and every required visible behavior above passes. If anything fails, stop at the first failure and provide the complete output or exact visible behavior. That failure becomes a permanent regression before Subunit 3 can close.
