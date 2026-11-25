# ZERO-001 — foundation feature/workflow and security evidence (partial)

**Status:** executed bounded initial tests with open gaps; **0/4 TECH FULLY VERIFIED**, never promote old scope or partial green. **Frozen app commit:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA test tooling at test start: `b458bafe63b897437d7f3b9e7b300caf0b01d5d9`. Evidence raw stays only in the isolated workstation until approved private-vault archiving; no staging or production mutations.

## Original workflow cases (one related brick; <=5 distinct scheduled checks)

| Scenario | Actual test/check | Outcome and boundary |
|---|---|---|
| M1.01.01 — runtime secrets/demo isolation and startup | `node --test --test-concurrency=1 tests/browser/security-response-headers.browser.test.mjs` on disposable 127.0.0.1 Chromium + same case once more with a temporary logging-only duplicate and then removed | **MIXED / test timing concern**. Original source case failed assertion requiring observed `script-src-attr`; one diagnostic rerun passed worker and company login, inline handler remained blocked and CSP violations were observed. No security exploit found in those probes; not full startup/session review. |
| M1.01.02 — migrations/history/rollback | Two explicitly named real PG16 original source tests under separate disposable localhost PG16 (not either existing shared PG cluster). | **2/2 PASS scoped**: 139 migrations, idempotency, unknown migration refusal, checksum mismatch refusal, prod/preview rollback prohibition. Full reverse rollback/recovery and remaining original tests not run in this batch. |
| M1.01.03 — exact canonical candidate CI | Read-only `gh run list --commit 7ff30ea...` | **91/92 SUCCESS, 1 FAIL**, independent audit [44915185823](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/44915185823). Later QA audit corrections are separate from this pinned source. Not full CI green. |
| M1.01.04 — production configuration/health/rollback candidate | Read-only `curl -k` of existing loopback HTTPS worker login; inspect only stage metadata SHA and safe response headers | **Partial only**: signed-out login HTTP200, CSP/HSTS/anti-frame/no-sniff present; loopback stage metadata SHA **does not match pinned source SHA**, local cert not publicly trusted. Did not execute rollback or mutate live stage. Cannot certify exact candidate parity. |

**Five distinct checked units maximum:** one real Chromium source case (the same case retried diagnostically), two real PG16 source cases, one exact-SHA CI read, and one stage read-only health/security check. This does **not** mean five full scenario certifications.

## Three discipline outcomes (one AI's specialist lenses, not independent agency credentials)

- **ENGINEER — SCOPED PASS / INCOMPLETE:** Real database migration tests 2/2 passed and stage responds. Browser event check fluctuated, full startup/release parity and reverse migration/rollback recovery missing. No product app/source edits.
- **CYBERSECURITY — SCOPED / NOT FULL PENTEST:** Inline event execution was blocked on retry; schema refuses unrecognized/checksum-manipulated migration; secure headers present. No full six-role, authenticated, attack-surface pentest or approved stage exploitation. High/critical finding total **UNKNOWN**, not zero.
- **REVIEWER — NOT APPROVED:** Pinned exact version is not proven identical to running stage; one hosted QA audit fails, CSP case initially failed and recovered with extra logging. Original 218 source/QA evidence and no-production-mutation safeguards retained. Further original test cases and independent review are required.

## Non-stalling continuation

Park unfinished M1.01.01–M1.01.04 in the original receipt register, **without** awarding technical pass. Continue the next safe independent original batch `ZERO-002` while preserving these defects. Revisit CSP event intermittency, signed source CI audit, and exact-stage/rollback on a controlled test deployment before final technical signoff. Do not run invasive testing or delete existing live PG/stage.

## Evidence checksums

- `M1.01.01`: `private-workstation:artifacts/agency-zero/ZERO-001/m10101-browser.log` SHA256 `e968b8f0e73ba81a4ee8bd3a0b003491ffd1d3fa2c37b8758668b4fdf2b5bddf`, `private-workstation:artifacts/agency-zero/ZERO-001/m10101-browser-diagnostic.log` SHA256 `ef34d970157c4275448df300a5a62b69c0e5d86cb56ce869f3a05f1ec99a4441`
- `M1.01.02`: `private-workstation:artifacts/agency-zero/ZERO-001/m10102-postgres.log` SHA256 `43b55221e0f7411fffcc76716084c2dd3863f0ff473666c688364f3512d1f22e`
- `M1.01.03`: `private-workstation:artifacts/agency-zero/ZERO-001/m10103-ci-summary.json` SHA256 `9f1399ccb11be56d38556a5c9762b66d8b18327207c378b81299232f7254ebc0`
- `M1.01.04`: `private-workstation:artifacts/agency-zero/ZERO-001/m10104-stage-readonly.json` SHA256 `63eea0f18dee5e45992fbaa9abac6f267e4870ef936224f719f3cc8a9bc7dd09`

Recorded UTC: 2026-11-22T17:13:27.228165+00:00
