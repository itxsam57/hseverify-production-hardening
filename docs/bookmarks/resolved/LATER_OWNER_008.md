# LATER-OWNER-008 — Resolved

## Defect

On Windows 10 with Node.js `v22.23.1`, the first owner run of:

```cmd
npm run test:profile-overflow
```

returned three passing tests and one failing test. The failure came from an exact LF-only multiline string assertion for the `.profile-history-card` CSS rule. The Windows checkout used CRLF even though the required `overflow: hidden` declaration was present.

## Repair

Pull request #14 was squash-merged as:

```text
bf7c715a6e7e6490af7030a8026f3a2774c5b190
```

The repair:

- normalizes LF, CRLF and legacy CR before source inspection;
- checks CSS selector/declaration semantics instead of exact formatting;
- verifies history-card containment and table-local horizontal scrolling;
- adds a synthetic CRLF regression to Linux CI;
- leaves production Profile CSS unchanged.

Exact-head workflow `30748022290`, job `91496938028`, passed five Profile overflow contracts, the full application gate, normal development smoke, protected PGlite runtime, production build, portable preview and artifact upload.

## Owner retest

- **Owner result:** PASS
- **Accepted:** 2 August 2026
- **Environment:** Windows 10, Node.js `v22.23.1`, normal Command Prompt
- **Focused result:** five tests passed, zero failed

The owner explicitly confirmed receiving the required result after pulling the merged repair.

## Remaining boundary

This resolves only `LATER-OWNER-008`, the Windows line-ending-sensitive validator defect.

`LATER-OWNER-007` remains open until the owner completes the actual Worker Profile browser matrix at normal desktop width, 860px, 768px, 390px, 320px, and 125%/150%/200% zoom, with no page-wide horizontal overflow and table-only horizontal scrolling.

M1.02 remains **IMPLEMENTED — OWNER RETEST REQUIRED**. M1.03 remains blocked.
