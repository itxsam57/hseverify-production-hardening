# LATER-OWNER-016 — Company tenant-scope delete confirmation

## Status

**RESOLVED — OWNER PASS — 6 AUGUST 2026**

## Owner-observed failure

On the M1.04 Company tenant-scope demonstration, the visible **Delete** control did not complete the destructive workflow for the selected synthetic record.

## Root cause

`RecordEditor` renders the update workflow inside a form. The shared `ConfirmDialog` previously rendered its own server-action form inside the caller's form. Nested forms are invalid HTML and allowed the browser to ignore the destructive form boundary or submit the surrounding edit form instead.

## Repair

- Pull request: `#32`
- Validated repair head: `bf82255de88f174f73eea8c2d8cb77911b556f89`
- Repair merge commit: `012ee75764b857345fc69499e8c19597dfceeffa`
- Validated PR run: `31065250685`
- Validated PR job: `92501506033`
- Merged-main run: `31065467924`
- Merged-main job: `92502148456`

The confirmation dialog and its destructive action form now render through a React portal attached to `document.body`. The Delete trigger and Cancel controls remain non-submitting buttons. Confirmed deletion exposes a `Deleting…` pending state and blocks duplicate submission while preserving the existing tenant-scoped delete service, non-enumerating result, route revalidation and redirect.

## Automated result

The exact repair head and merged-main commit passed the complete engineering gate, including:

- destructive confirmation source contract;
- database, authentication, authorization and tenant-isolation regressions;
- strict TypeScript and ESLint;
- development/runtime checks;
- production build and standalone preview;
- generated handoff and release evidence.

## Owner retest result

The owner confirmed that everything passed after pulling merged `main` and retesting the repaired workflow:

1. Delete opened the confirmation dialog without submitting the edit form.
2. Cancel closed the dialog and preserved the record.
3. Confirmed deletion executed once.
4. The pending state prevented duplicate submission.
5. The selected record disappeared.
6. The visible record count decreased.
7. The success result appeared without a manual browser refresh.

`LATER-OWNER-016` is closed. M1.04 subunit 4 is accepted. M1.04 remains in progress until subunit 5 and final brick acceptance pass.
