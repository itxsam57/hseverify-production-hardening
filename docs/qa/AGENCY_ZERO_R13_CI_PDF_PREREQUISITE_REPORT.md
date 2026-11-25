# ZERO-R13 — Independent full audit: credential PDF extractor prerequisite

**Scope:** one related CI dependency/credential-public-consumer regression, four exact original red focused tests (4/4 *local scoped pass*). This is **not** four fully verified original Masterplan scenarios. App runtime source stays frozen at `7ff30ea140a5145e5d5ba761f7c7aef24c895269`; 218 original IDs, 58 batches and historical evidence unchanged.

## Independent CI terminal evidence

- Previous audit [45104121464](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45104121464) FAILED due migration 0130 rollback order in original test. Protected draft [PR #207](https://github.com/itxsam57/hseverify-production-hardening/pull/207) already fixes **that** test; original targeted test 1/1 PASS, and the new hosted run progressed beyond it.
- Corrected test-source SHA `0d7ed722c49789525721b3d924b3375c4ff56d06`, exact [independent audit 45109434561](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/45109434561) **TERMINAL FAILURE**: audited `FINAL-AUDIT.json` 1 critical / 0 high / 14 medium / 61 low / 65 info. Sole critical is generic `existing_full_regression_crosscheck` command exit 1, **not a confirmed exploitable vulnerability**.
- Full `verify:full` credential authentication phase: **30 pass / 4 fail**. All four exceptions at `spawnSync("pdftotext", ...)` tests with `parsed.status === null`: genuine signed Unicode PDF, terminal hyphen, configured UTC validity in public PDF, and appeal renewal PDF. The independent audit workflow did **not** install/check `pdftotext`, while `masterplan-completion-qa.yml`, `engineering-factory.yml` and another QA workflow already install Poppler. This strongly indicates missing CI executable/tool setup; a future hosted run must verify cause and result.
- Final JSON SHA256 `8f8507d7a6d617bf5080a3b2cf13692e85cb55f811d72910b05b817f9a229892`. Full failure log SHA256 `966b5c4a3c7a83f1b1972898c932dfd78564c41173fbe71091311815c5b5ac10`. Private source: `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r12/ci-final-corrected`.

## Guarded minimal correction

In **only** `.github/workflows/independent-full-system-audit.yml`, insert prerequisite immediately after locked `npm ci`:

```yaml
      - name: Install PDF text verifier for real credential assertions
        run: |
          if ! command -v pdftotext >/dev/null 2>&1; then
            sudo apt-get update -qq
            sudo apt-get install -y --no-install-recommends poppler-utils
          fi
          pdftotext -v
```

No product/src/database/test assertion changes, no exit masking or disabled checks. This matches previously accepted QA workflow setup. YAML parsed, step precedes the regression command, `npm run qa:preflight-218` and `python3 scripts/agency_zero_control.py --check` PASS.

## Independent discipline results

**ENGINEER — SCOPED PASS:** Linux workstation Poppler v24.02.0 executable present; running the **four exact CI-red credential tests** on pinned application source produced **4/4 PASS, process exit 0**, including PDF authenticity, Unicode, hyphen, exact signed issue/expiry dates, appeal renewal. Private raw `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r13/r13_pdf_four_focus.log` SHA256 `add283d6571520e8eaeab09ad7a68fbf74143bde1ef36d5b4a3f68a5553fede3`.

**CYBERSECURITY — SCOPED PASS:** CI now requires real external PDF parsing rather than skipping or accepting malformed output; no PDF/credential signature trust boundary weakened. No complete pentest or live provider inference.

**REVIEWER — BLOCKED pending fresh hosted final result:** Root-cause hypothesis is strongly supported, but a new **hosted full independent audit on exact patched workflow SHA** must reach terminal success before R06/R13 independent CI red is cleared. No release/owner-ready signoff; 0/218 TECH FULL.

**NEXT:** Guarded commit/push to draft PR #207, dispatch new [independent full-system audit](https://github.com/itxsam57/hseverify-production-hardening/actions/workflows/independent-full-system-audit.yml) on exact patched branch SHA; preserve full raw report, classify any new red without hiding; continue cross-role evidence cases in original group batches <=5. **OWNER TEST READY: NO.**
