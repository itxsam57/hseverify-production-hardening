# M1.07 — Worker profile DOB input intermittently cleared during rapid entry

Status: isolated local patch PASS; 218/218 release certification still 0. GO: NO.

## Reproduced RED
- Base QA SHA d96b36e1db64075e6e202277806729df1a91bbe7, isolated localhost Next.js + disposable PGlite/Chromium.
- Original full Worker browser journey failed twice when navigating to profile Contact step after Save and continue. Server accepted transport HTTP 200 but returned 'Enter a valid date of birth before today.'
- Instrumented failures proved the native date input was empty BEFORE save, and FormData omitted 1990-01-15. In one focused run the date was empty immediately after Playwright fill, before any server request; upstream input/state bug, not server validation bypass.
- RED receipts in hseverify-profile-nav-red-20261107/.autopilot/artifacts: 20261107-M107-full-worker-RED-first.log, ...-RED-repeat.log, 20261107-M107-dob-payload-probe-3.log, 20261107-M107-date-timeline-4.log.

## Narrow patch
- Personal date input now uses native defaultValue={record.personal.dateOfBirth} with key={record.version}; the browser field retains its input value without each-keystroke React controlled state resets. Server-side date validation and sensitive-field locking remain unchanged.
- Original full browser journey now checks DOB value immediately before Save. M1.07.02 invalid-save retry checks DOB retained after unrelated invalid field.

## Local patched regression
- Focused Chromium rapid-entry 6/6 PASS: correct 1990-01-15 in input/FormData and POST, navigation to Contact 0.5–0.7 s; .../20261107-M107-uncontrolled-date-fix-probe-{1..6}.log.
- Original full Worker registration/identity/evidence/passport/privacy/share/revoke browser 1/1 PASS; M1.07.02 rejected save/retry/navigation/DB audit 1/1 PASS; initial identity rejection 1/1 PASS; .../20261107-M107-fix-real-browser-*.log.
- npm run test:profile 5/5 PASS; test:authorization 18/18 PASS; typecheck PASS; lint exit0 (nine unrelated prior warnings); Next build PASS with disposable test environment. Exit receipts .../20261107-M107-quality-status.tsv.

## Remaining GO gates
- Guarded commit/push, exact committed SHA retest, QA merge and exact merged SHA CI/browser tests.
- Protected staging, cross-role API abuses, negative/retry/race/interruption, external provider dependencies, full penetration test, load/restore and Owner UAT remain outstanding. M1.07 and M3.03 are not FULLY_VERIFIED.
