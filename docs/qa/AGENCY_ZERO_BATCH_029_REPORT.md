# ZERO-029 — Assessment delivery technical evidence

**5 of at most five original related workflow units attempted.** Selected source case results: **1 PASS**, **4 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `fb657b64e3164735b5df6b114a8bc756ce345163`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M2.07.01` | A14 real Worker browser enforces media permission denial, partial acquisition cleanup, BLOCK and REVIEW policies | SCOPED PASS |
| `M2.07.02` | tests/platform/assessment-attempt-answer-runtime.test.mjs (760.962787ms) | FAIL_OR_UNPROVEN |
| `M2.07.03` | tests/platform/assessment-attempt-begin-runtime.test.mjs (719.888629ms) | FAIL_OR_UNPROVEN |
| `M2.07.04` | tests/platform/assessment-attempt-begin-runtime.test.mjs (727.43868ms) | FAIL_OR_UNPROVEN |
| `M2.07.05` | tests/platform/assessment-attempt-begin-runtime.test.mjs (762.666839ms) | FAIL_OR_UNPROVEN |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. At least one check failed or could not be proven; triage from raw log required. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M2.07.01`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M2.07.02`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.
- `M2.07.03`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.
- `M2.07.04`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.
- `M2.07.05`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.

## Raw test evidence (workstation-private; SHA256)

- `M2.07.01`: `private-workstation:artifacts/agency-zero/ZERO-029/M2.07.01.log` — SHA256 `eb8925ebb6a1fb7083ac65bb0b5ce41338893a2b1a9a0ddb8e35a9acf1a24d5b`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M2.07.02`: `private-workstation:artifacts/agency-zero/ZERO-029/M2.07.02.log` — SHA256 `8a91dac4ea518fb1e415bbdad02f5ee621e6ed6279521b75648ff9b4a2669327`, selected run exit 1, TAP {'tests': 1, 'pass': 0, 'fail': 1, 'skipped': 0}.
- `M2.07.03`: `private-workstation:artifacts/agency-zero/ZERO-029/M2.07.03.log` — SHA256 `395bc2c8d6de1ea0665485d265e6614284c73fa60fc9ef4f4d37367475248065`, selected run exit 1, TAP {'tests': 1, 'pass': 0, 'fail': 1, 'skipped': 0}.
- `M2.07.04`: `private-workstation:artifacts/agency-zero/ZERO-029/M2.07.04.log` — SHA256 `17767a442fed75fda4902095d827b514feace6205be81a1db8017e374da344ed`, selected run exit 1, TAP {'tests': 1, 'pass': 0, 'fail': 1, 'skipped': 0}.
- `M2.07.05`: `private-workstation:artifacts/agency-zero/ZERO-029/M2.07.05.log` — SHA256 `999f0cb4cb560e2c870bb79725fa35e4c9b2d4f7bd7b71625a41f7bbd9eee293`, selected run exit 1, TAP {'tests': 1, 'pass': 0, 'fail': 1, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T19:35:07.821117+00:00

## Initial harness-only failure and targeted, successful revalidation

The initial direct `node --test` invocation **failed before testing the product** because the official compiled runtime environment was not supplied. Source runner used for the retry: `scripts/run-assessment-attempt-tests.mjs`. We built its exact transpiled runtime into an isolated disposable output directory, then reran ONLY the previously blocked source checks. All retry logs report **1/1 PASS** each (zero skipped), but **NO original scenario becomes TECH FULLY VERIFIED**. Both original setup failures and new proofs are retained.

- `M2.07.02`: revalidation PASS 1/1, private log SHA256 `4203f7f5e39da0e891bda53cafba295bcf8a09a16dd097265e0da18bdd356546`; original failed log still indexed.
- `M2.07.03`: revalidation PASS 1/1, private log SHA256 `38bca59500ac8db325171207ced4c9ddfe16b00ba6ac0638cf7f09805bfd92e8`; original failed log still indexed.
- `M2.07.04`: revalidation PASS 1/1, private log SHA256 `638be44e6c7ecc8623ec824683123a2b5f4e4f315160ccf2c30846d3a7253195`; original failed log still indexed.
- `M2.07.05`: revalidation PASS 1/1, private log SHA256 `dea3de1b9ce1326d4733a8b43a5dee4503ace10361585179a6e95f318031fedd`; original failed log still indexed.

Official runtime bootstrap SHA256 `1f2f5ddd0895bcd2e30ba464e9af1bbda6d2eb5ed586f99d1accc442a787b20b`. Original failed `results.tsv` remains a historical attempt; the cursor holds the reconciled latest **scoped** result.

## Original scenario gaps not covered by selected source test

- `M2.07.01`: Real browser synthetic permission BLOCK/REVIEW and cleanup passed. Physical camera/microphone/screen devices, fullscreen device matrix, recording consent and real hardware failure/recovery are still unverified.
- `M2.07.02`: Selected answer progression test proves only exact next pinned question after committed answer. Required-answer validation, strict no-backtracking across full Worker UI, save confirmation and retry network failure need direct checks.
- `M2.07.03`: Chosen controlled-review-mode TIMING source test proves immutable timer and expired writes denial; it does NOT test prior-answer revisit, flag, revision CAS, visual controlled-review buttons or successful change. Specific original requirement still unverified.
- `M2.07.04`: Section timer/lock service test passed; within-section navigation, section-review flags/revisions, final submit UI and cross-device section lock must be tested in live Worker browser.
- `M2.07.05`: Actual durable worker auto-submits exactly once in service test. Candidate UI countdown/expiry, reconnect/retry load, human-review handoff and mixed attempted answers remain incomplete.

**Technical sign-off: INCOMPLETE.** All selected source cases have scoped PASS only; independent ENGINEER, CYBERSECURITY and REVIEWER comprehensive evidence still required.
