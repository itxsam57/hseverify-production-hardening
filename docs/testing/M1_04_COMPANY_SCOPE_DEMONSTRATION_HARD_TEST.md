# M1.04 Subunit 4 — Windows Owner Hard Test

## Purpose

Confirm the visible Company-only tenant-scope demonstration works without refresh-dependent navigation, remains visually aligned and responsive, uses a functional destructive confirmation flow, and denies copied-role access. Database, cross-tenant, stale-authority and concurrency behavior is automated and must not be repeated manually unless the generated handoff reports a failure.

## Preconditions

- Normal Windows Command Prompt.
- Repository: `C:\Users\arsla\hseverify`.
- Merged `main` commit supplied after CI.
- Existing synthetic local Company account with valid TOTP.
- Existing synthetic local Worker account.
- Use synthetic demonstration text only.
- The persistent local database must be migrated through the repository's latest migration before the server starts.

## Owner test A — Company protected demonstration

1. Run `npm run setup:local` and confirm environment validation and every pending migration pass.
2. Start the application with `npm run dev`.
3. Sign in at `http://localhost:3000/company/login` and complete TOTP.
4. On the Company dashboard, open **Open tenant-scope demonstration**.
5. At normal desktop width, confirm **Tenant reference**, **Membership role**, and **Visible records** are three equal-height cards in one aligned row.
6. Confirm the tenant reference wraps inside its card without widening the page or overlapping another card.
7. Narrow the browser window and confirm the three cards and the create/edit fields stack into one clean column with no horizontal page scrolling.
8. Return to normal desktop width and confirm the create form fields share the same top alignment and card edges remain even.
9. Confirm the page shows a masked tenant reference, membership role and synthetic-data warning.
10. Confirm either the explicit empty state or only this tenant's prior neutral demonstration records.
11. Submit invalid/missing create values and confirm field errors appear while the page remains usable and aligned.
12. Create a record using a unique lowercase key and synthetic title/note.
13. Confirm it appears without manually refreshing the browser.
14. Edit it and save.
15. Confirm the updated value/version appears without manually refreshing.
16. Return to the Company dashboard, reopen the demonstration and confirm persistence.
17. Click **Delete** and confirm the destructive dialog opens without submitting the edit form.
18. Click **Cancel** and confirm the dialog closes and the record remains unchanged.
19. Click **Delete** again, then click **Delete demonstration record** once.
20. Confirm the confirmation button changes to **Deleting…** and cannot be double-submitted.
21. Confirm the record disappears, **Visible records** decreases, and the explicit success message appears without a manual browser refresh.

Expected: every operation remains inside the authenticated Company tenant; no tenant selector appears; the cards and fields remain aligned and contained; create/update/delete do not require a manual refresh to become visible; cancel is non-destructive; confirmed delete executes exactly once through its own valid form boundary.

## Owner test B — Worker copied-route denial

1. Sign out of Company.
2. Sign in as Worker.
3. Paste `http://localhost:3000/company/tenant-scope` directly.
4. Confirm Company content never appears and the access-denied boundary is shown.
5. Return to the Worker dashboard and confirm the Worker session remains usable.
6. Sign out.

Expected: no role switch, Company data exposure or Worker-session corruption.

## Clean completion

1. Stop the server with `Ctrl+C`.
2. Confirm Command Prompt returns normally.
3. Run:

```cmd
git pull --ff-only origin main && git status --short && git diff --check && git status -sb
```

Expected:

- pull succeeds;
- `git status --short` prints nothing;
- `git diff --check` prints nothing;
- final line is `## main...origin/main`.

## Failure rule

Stop at the first failure and record:

```text
ID: LATER-OWNER-###
Area: M1.04 subunit 4
Exact route/control:
Steps to reproduce:
Expected:
Observed:
Browser/OS:
Severity:
```

Subunit 5 remains blocked until the automated gate, visible browser steps, clean shutdown and synchronized Git state all pass.
