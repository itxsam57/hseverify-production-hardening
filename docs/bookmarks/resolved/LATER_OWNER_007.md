# LATER-OWNER-007 — Resolved

## Defect

On Windows 10 in Google Chrome, `/worker/profile` created page-wide horizontal overflow at normal desktop width and 100% zoom. The complete shell and sidebar moved horizontally, the Ready to submit panel was clipped and the Submit profile control was partly outside the viewport.

## Repair

Pull request #13 was squash-merged as:

```text
612e8948c24bb007e0dfc6f266b0c81a50a7408a
```

The repair added shell-wide shrink containment, Profile container queries, bounded action tracks and controls, and history-table-local horizontal scrolling. Pull request #14 then made the focused regression platform-stable on Windows CRLF checkouts.

## Owner retest

- **Owner result:** PASS
- **Accepted:** 2 August 2026
- **Environment:** Windows 10, Google Chrome, normal Command Prompt
- **Route:** `/worker/profile`

The owner passed the required matrix:

- normal desktop at 100% zoom;
- 860 × 900;
- 768 × 900;
- 390 × 844;
- 320 × 700;
- 125% zoom;
- 150% zoom;
- 200% zoom.

At every required size and zoom level:

- `pageWideOverflow` was false;
- the page, shell, header and navigation remained contained;
- Profile cards reflowed before clipping;
- Ready to submit and Submit profile remained fully visible and usable;
- horizontal scrolling was restricted to the Profile history table when needed.

The owner also continued testing beyond the required acceptance boundary through 500% browser zoom and reported that the page remained fixed.

## Result

`LATER-OWNER-007` is resolved by owner retest.

The remaining M1.02 acceptance action is the final development-server shutdown and clean tracked-source confirmation. M1.03 remains blocked until M1.02 receives the complete owner PASS and DONE record.
