# M1.02 Worker Profile Page-Width Overflow — Windows Owner Retest

## Defects under test

`LATER-OWNER-007` was found on Windows 10 in Google Chrome while testing commit `362793d`.

At `http://localhost:3000/worker/profile`, the complete Worker Portal became wider than the browser viewport. The page gained a horizontal scrollbar, the sidebar moved off screen when the page was scrolled horizontally, the right-side Ready to submit panel was clipped and the Submit profile button was partly outside the visible viewport.

`LATER-OWNER-008` was found during the first Windows retest of the merged Profile overflow repair. The real CSS contained the required history-card containment, but `npm run test:profile-overflow` compared an exact LF-only multiline string. A Windows CRLF checkout therefore reported 3 pass / 1 fail even though the declaration was present.

Both defects are release-blocking until the Windows owner retest passes.

## Repair boundary

The repair must prove all of the following:

- the Worker shell never exceeds its viewport;
- the fixed desktop sidebar does not add width beyond the viewport;
- the main column uses only the remaining width;
- Profile layout decisions use the Profile container width, not the full browser width;
- grid and flex descendants can shrink because their minimum inline size is zero;
- the action/history column stacks before clipping;
- the Submit profile control remains fully visible;
- only the Profile history table may scroll horizontally inside its own region;
- page-wide overflow is repaired rather than hidden on `body` or the portal shell;
- automated CSS contracts inspect selector/declaration meaning rather than platform-specific line endings;
- a synthetic CRLF regression runs in every CI environment.

## Required environment

- Windows 10
- Node.js `v22.23.1`
- Google Chrome
- normal non-Administrator Command Prompt
- Chrome zoom reset to 100% before starting
- existing `.env.local` and `.data` preserved

## A — Pull the repairs and establish a clean baseline

Stop every HSE Verify Node process, then run:

```cmd
git checkout main
git restore --source=HEAD -- tsconfig.json
git status --short
git pull --ff-only origin main
git log -5 --oneline
npm ci
git status --short
```

PASS when:

- both the Profile overflow layout repair and Windows-safe test repair are present;
- the pull and locked installation succeed;
- `git status --short` prints nothing;
- `.env.local`, `.data` and the Worker database are unchanged.

## B — Permanent overflow contract

```cmd
npm run test:profile-overflow
```

PASS when five tests pass and zero fail:

1. CSS contract inspection is stable across LF and CRLF checkouts.
2. Worker shell and Profile keep shrink containment through every layout boundary.
3. Profile history owns the only horizontal scroll region.
4. Profile action controls remain bounded by their cards.
5. Required desktop, tablet, mobile and zoom widths switch before clipping.

The test must not require changing Git line-ending settings.

## C — Complete application gate

```cmd
npm run check
```

PASS only when the full gate succeeds, including:

```text
Worker Profile fields, container reflow, shell shrink containment, bounded actions and table-only horizontal scrolling passed.
```

and:

```text
Normal development mode smoke passed with HTTP 200, isolated output, clean shutdown and unchanged source configuration.
Application PGlite runtime smoke passed with isolated Next output and unchanged source configuration.
Deterministic Next production build passed without source configuration changes.
```

After the gate:

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

Both commands must print nothing.

## D — Start the real Worker Portal

```cmd
npm run dev
```

Sign in through the Worker login page, then open:

```text
http://localhost:3000/worker/profile
```

Use the Profile page normally. Switch between all three Profile sections and confirm the Ready to submit panel, activity table and correction section remain rendered.

## E — Objective overflow measurement

At each test size below, open Chrome DevTools Console and run:

```js
(() => {
  const root = document.documentElement;
  const body = document.body;
  const table = document.querySelector('.profile-history-card .ds-table-wrap');
  return {
    viewportWidth: root.clientWidth,
    documentWidth: root.scrollWidth,
    bodyWidth: body.scrollWidth,
    pageWideOverflow: Math.max(root.scrollWidth, body.scrollWidth) > root.clientWidth + 1,
    historyTable: table
      ? {
          clientWidth: table.clientWidth,
          scrollWidth: table.scrollWidth,
          internalOverflow: table.scrollWidth > table.clientWidth + 1
        }
      : null
  };
})()
```

PASS at every size when:

- `pageWideOverflow` is `false`;
- the browser has no page-wide horizontal scrollbar;
- any necessary horizontal scrolling is limited to `historyTable`;
- scrolling the history table does not move the sidebar, header or Profile cards.

## F — Required width matrix at 100% zoom

Test each width separately:

### Normal desktop width

Use the normal maximized desktop browser at 100% zoom.

Required behavior:

- sidebar remains fixed and completely visible;
- header controls remain visible;
- Profile editor and action/history column fit or switch layout without clipping;
- Ready to submit panel is complete;
- Submit profile button is completely visible and clickable;
- no page-wide horizontal scrollbar.

### 860px

Use Chrome DevTools responsive mode at exactly `860 × 900` and 100% zoom.

Required behavior:

- desktop sidebar is replaced by the mobile navigation pattern;
- Profile editor, submit panel and history stack within the available width;
- no clipped header control;
- no page-wide horizontal scrollbar.

### 768px

Use exactly `768 × 900`.

Required behavior:

- all Profile cards fit the content area;
- action controls remain visible;
- the history table may scroll only inside its own bordered table region;
- no page-wide horizontal scrollbar.

### 390px

Use exactly `390 × 844`.

Required behavior:

- steps, facts, fields, actions and cards use a single column;
- labels and long values wrap rather than widening the page;
- Submit profile button uses the available card width;
- no page-wide horizontal scrollbar.

### 320px

Use exactly `320 × 700`.

Required behavior:

- no element extends outside the viewport;
- header/menu controls remain reachable;
- form fields and buttons remain usable;
- only the history table region may scroll horizontally;
- no page-wide horizontal scrollbar.

## G — Required browser zoom matrix

Exit DevTools responsive mode and return to the normal desktop window. Test:

1. 125% zoom
2. 150% zoom
3. 200% zoom

At every zoom level:

- refresh the Profile route;
- repeat the Console measurement from Part E;
- switch Profile sections;
- confirm Ready to submit and Submit profile remain complete and usable;
- confirm the layout stacks before the right column clips;
- confirm no page-wide horizontal scrollbar;
- confirm the history table retains its own local scrolling when needed.

At 200% zoom, keyboard focus must remain visible and all content/actions must remain reachable without horizontal page scrolling.

## H — Interaction and containment checks

At normal desktop, 768px and 320px:

- tab through header controls, Profile steps, fields and action buttons;
- activate each Profile step;
- type into representative fields without changing element width;
- focus and horizontally scroll the history table region if it overflows;
- confirm the page itself does not move left or right;
- confirm the sidebar does not disappear through horizontal document scrolling;
- confirm no hydration, layout or runtime errors appear in the Console.

## I — Shutdown and clean repository state

Stop the server with `Ctrl+C`, then run:

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

PASS when both commands print nothing and no HSE Verify Node process remains.

## Owner result format

```text
M1.02 WORKER PROFILE OVERFLOW OWNER RETEST

Commit tested:
Operating system: Windows 10
Node version: v22.23.1
Browser: Google Chrome
Terminal: Normal Command Prompt
Developer Mode: OFF/ON

A Pull/install and clean baseline: PASS/FAIL
B npm run test:profile-overflow: PASS/FAIL
C Full npm run check: PASS/FAIL
D Normal desktop 100%: PASS/FAIL
E 860px: PASS/FAIL
F 768px: PASS/FAIL
G 390px: PASS/FAIL
H 320px: PASS/FAIL
I 125% zoom: PASS/FAIL
J 150% zoom: PASS/FAIL
K 200% zoom: PASS/FAIL
L History table scroll is local only: PASS/FAIL
M Sidebar/header/action controls remain contained: PASS/FAIL
N Git state and shutdown clean: PASS/FAIL
O No Administrator or Developer Mode requirement: PASS/FAIL

Defects found:
1.
2.

Overall: PASS/FAIL
```

M1.03 remains blocked until this retest, the previous M1.02 repair retests and all remaining browser/accessibility sections pass.
