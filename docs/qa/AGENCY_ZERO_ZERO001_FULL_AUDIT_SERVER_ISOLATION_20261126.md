# ZERO — full-audit synthetic server isolation and credential browser failure diagnostics



Original batch ZERO-001/058; original M1.01.03; 0/4 ZERO001 TECH FULL, 0/218 global TECH FULL; OWNER TESTING READY: NO.



## Genuine failure held RED

Both separate hosted complete audits #45813265507 SHA3333929 and #45816580980 SHA7d7fa6b terminated FAILED: original credential-validity browser test Company Workers Assurance heading 15s timeout, existing full regression exit1; no independent full gate accepted. A source-identical local isolated Chromium case passed1/1, does not override either real hosted failure.

## Scoped code/harness change only

Independent audit workflow previously ran a standalone audit Next development server and kept it alive throughout a subsequently launched full regression. After browser precheck artifacts are uploaded, a new conditional step verifies that its PID is numeric and the command matches the expected audit process, then stops its own process group; a bounded exit check refuses unsafe crosscheck overlap. Old final cleanup remains. This is a suspected source of contention, **not yet a proven root cause**.

The exact browser credential test retains its 15-second Assurance visible assertion. On error only it prints HTTP status, route path, row counts, empty-state and worker-heading booleans and error counts: **no email, credentials, cookies, identifiers or page HTML**. Original test remains independently sign-off blocking.

Three distinct bounded QA contract tests 3/3 PASS exit0, raw SHA256 aa8845a8e5305c5e58a8531c5a028aedc5f85f81d00ba641534911d34a6b21dc. Workflow parses YAML, both modified shell steps pass bash -n, browser test passes node --check, git diff --check exit0. This does NOT demonstrate the hosted full regression is green.

## Three-role evaluation

ENGINEER — scoped contract PASS, hosted blocked pending. CYBERSECURITY — scoped process ownership/fail-closed and diagnostic minimization PASS, no pen signoff. REVIEWER — AI reviewed existing two failures and deterministic local tests, refuses FULL.

## Evidence

Private ECR /home/ubuntu/work/.hse-qa-tmp/agency-zero-sequential-closure-001/ZERO001-M10103-CI-SERVER-ISOLATION-PATCH-THREE-REVIEW-ECR-20261126.json SHA256 8a7dc492eb05dec7e15b543ed2d1bf1383df7841ff24d16e32f73c9ab484f9fa.

## Next

Guarded QA-only stacked draft PR and workflow_dispatch on exact commit. Preserve all positive, negative, retry, permission, cross-role and adapter requirements and 58 original batches, do not repin app source silently or alter shared staging.
