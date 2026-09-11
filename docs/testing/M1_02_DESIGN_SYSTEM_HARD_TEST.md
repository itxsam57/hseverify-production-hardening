# M1.02 Design System and Global UX — Owner Hard Test

## Gate status

M1.02 remains **IMPLEMENTED — OWNER TEST PENDING** after merge until every required section below passes.

Use dummy test data only. Preserve the existing `.data/postgres-owner-test` database so this test also confirms that visual-system changes did not reset or replace Worker Profile data.

## Part A — Pull and validate the exact merged build

Stop every running HSE Verify development or preview process.

```bash
git checkout main
git pull origin main
git log -1 --oneline
npm ci
git status --short
```

PASS when:

- the expected M1.02 merge is present;
- `npm ci` succeeds;
- `package-lock.json` remains unchanged;
- no high-severity production dependency warning is reported.

Run:

```bash
npm run check:design-system
npm run check
npm run preview:smoke
```

PASS only when every command exits successfully.

## Part B — Desktop visual continuity

Start the application:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/worker/login
```

Use the configured demonstration Worker account.

At a desktop width around 1366–1440 pixels, verify:

- login email and password fields have visible labels, boundaries and focus states;
- the primary sign-in button is clearly visible;
- Dashboard sidebar, header, cards, status badges and actions render without overlap;
- Profile cards, steps, form controls and history render without missing CSS;
- no accepted Profile data is lost;
- the page does not flash unstyled content after navigation.

## Part C — Keyboard-only operation

Do not use the mouse for this section.

1. Reload the Worker login page.
2. Press `Tab` once.
3. Confirm the **Skip to main content** link becomes visible when applicable.
4. Continue tabbing through email, password and sign-in.
5. Sign in.
6. Tab through the portal header, notification control, account menu, sidebar links and page actions.
7. Open the account menu using the keyboard.
8. Reach **Sign out** and open its confirmation dialog.
9. Move between Cancel and Sign out.
10. Press Escape and confirm the dialog closes without signing out.

PASS when:

- focus is always visible;
- focus order follows visual order;
- no keyboard trap occurs;
- links and buttons activate with Enter/Space as appropriate;
- Escape closes the modal;
- focus returns to a sensible control after closing.

## Part D — Sign-out confirmation behavior

Open the account menu and select **Sign out**.

PASS when:

- a modal appears above the page;
- the background cannot be interacted with while the modal is open;
- the title and warning description are visible;
- Cancel closes it and keeps the session active;
- reopening and confirming signs the Worker out through the real server action;
- the browser reaches the signed-out Worker login state;
- no nested-dialog, hydration or console error occurs.

Sign in again before continuing.

## Part E — Mobile navigation continuity

Use responsive browser tools or resize the browser to each width:

- 860px;
- 768px;
- 390px;
- 320px.

At widths below the desktop sidebar breakpoint:

- the desktop sidebar must be hidden;
- a visible **Menu** control must appear;
- opening Menu must expose Dashboard and My profile;
- the current route must remain identifiable;
- both links must navigate without requiring manual refresh;
- the menu must not cover essential header controls permanently;
- no page-wide horizontal scrollbar should appear.

FAIL if the sidebar disappears with no replacement navigation.

## Part F — Forms, validation and status states

On Worker Profile, test Personal, Contact and Professional sections.

PASS when:

- text, date and number inputs are visibly bounded;
- the employment select is visibly bounded;
- textarea and checkbox states are visible when available;
- hover and keyboard focus states are distinguishable;
- disabled identity-linked fields look disabled;
- an intentionally empty required field produces a visible error border/message;
- other entered values remain present after the validation error;
- Save changes and Save and continue retain their existing behavior;
- success feedback remains visible and understandable.

Restore valid test values afterward.

## Part G — Table behavior

Open the Profile history area.

PASS when:

- the recent-activity table has a visible caption and column headers;
- Activity, Section, Time and Changes remain understandable;
- at narrow widths the table scrolls inside its own region;
- horizontal table scrolling does not move the entire page;
- keyboard focus can reach the table region;
- no audit data disappears because of the responsive layout.

If the test Profile has no audit rows, make one harmless Profile change and save it before retesting.

## Part H — Zoom and text scaling

Test at browser zoom levels:

- 125%;
- 150%;
- 200%.

At 200% zoom, verify login, Dashboard, Profile, mobile menu, account menu, dialog and Profile history.

PASS when:

- text is not clipped;
- buttons remain operable;
- controls do not overlap labels;
- content can be reached without two-dimensional page scrolling;
- modal content and actions remain visible or vertically scrollable;
- no fixed-height container hides content.

## Part I — Reduced motion and contrast

### Reduced motion

Enable reduced motion in the operating system or emulate `prefers-reduced-motion: reduce` in browser developer tools.

PASS when:

- the loading skeleton does not continuously animate;
- button/control transitions are removed or effectively immediate;
- no functionality depends on animation.

### Windows contrast/forced colours

Enable a Windows contrast theme or emulate forced colours when available.

PASS when:

- inputs, selects, buttons, cards and alerts retain visible boundaries;
- focus remains visible;
- text remains readable;
- selected/current navigation remains understandable.

If forced-colour emulation is unavailable, record **NOT AVAILABLE** for that subtest but still test normal high-contrast settings.

## Part J — Persistence and regression

Change one non-sensitive Profile field and save.

Then:

1. refresh Profile;
2. navigate to Dashboard and back;
3. stop `npm run dev`;
4. restart `npm run dev`;
5. sign in again;
6. confirm the value remains.

PASS when M1.02 causes no persistence, route-refresh, database-path or session regression.

## Part K — Console and terminal review

During the test, the browser console and terminal must contain none of the following:

```text
ProfileStorageConfigurationError
The "path" argument must be of type string
<html> cannot be a child of <body>
<body> cannot contain a nested <html>
Hydration failed
Failed to load stylesheet
```

Also reject:

- uncaught React errors;
- inaccessible modal warnings;
- duplicate key warnings;
- dead links or buttons;
- white screens;
- route loops;
- silent database reset;
- manual-refresh-only navigation.

## Owner result format

```text
M1.02 DESIGN SYSTEM OWNER HARD TEST

Commit tested:
Operating system: Windows
Node version:
Browser:

A Install and automated gates: PASS/FAIL
B Desktop continuity: PASS/FAIL
C Keyboard-only operation: PASS/FAIL
D Sign-out dialog: PASS/FAIL
E Mobile navigation: PASS/FAIL
F Forms and validation states: PASS/FAIL
G Table behavior: PASS/FAIL
H 200% zoom: PASS/FAIL
I Reduced motion: PASS/FAIL
J Forced colours/high contrast: PASS/FAIL/NOT AVAILABLE
K Persistence and restart: PASS/FAIL
L No console/terminal regression: PASS/FAIL

Defects found:
1.
2.

Overall: PASS/FAIL
```

M1.03 must not begin until **Overall: PASS** is recorded and M1.02 is marked DONE in the Milestone Path.
