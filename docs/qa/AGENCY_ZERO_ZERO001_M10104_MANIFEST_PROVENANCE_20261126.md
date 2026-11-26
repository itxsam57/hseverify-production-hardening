# ZERO-001 / Original M1.01.04 — Release manifest source provenance (isolated test)

**Scope:** One of the four original ZERO-001 scenarios, not a new scenario. Candidate draft only; 0/218 TECH FULL. No production, shared database, hosting or actual external stage used.

**Reproduced RED:** On exact parent SHA `4edbc5bbfae6bb10dd9e50b4b4c163fab8f308d6`, the real `scripts/create-release-manifest.mjs` in `preview` accepted caller-provided all-zero 40-character `HSE_RELEASE_SHA` and wrote it. This showed the standalone generator alone was not authenticating the source commit. Private raw receipt: `ZERO001-RELEASE-SOURCE-FORGED-RED-4edbc5b-20261126.manifest.json` SHA256 `d22a93d92e443328b757f8140e064e0f1c76a54796f44b346edd45f50eb49bf6`.

**Bounded code change:** Preview and production manifest generation now demands a 40-hex source commit that equals independently executed `git rev-parse HEAD`, plus no changes to tracked source/config files since that commit. Refuses unavailable Git, malformed SHA, mismatched SHA and changed tracked source. Developer/test mode behavior unchanged. It does not substitute for signed-artifact or independent identity proof.

**Actual negative tests before commit:** forged preview SHA FAIL-CLOSED; malformed production SHA FAIL-CLOSED; purported valid preview SHA with dirty tracked runtime source FAIL-CLOSED; development `local-development` PASS. All ran on the authorized disposable workstation, no provider requests or DB writes. Raw log hashes in private vault `ZERO001-M10104-manifest-source-guard-negative-precommit-20261126.*`.

**Important existing control:** `.github/workflows/zero001-review-build-provenance.yml` *already defines* GitHub OIDC `actions/attest@v4` signing of compiled file manifests and source metadata, with a branch-specific guard for `qa/zero001-candidate-modern-audit-20261125`. The CLI fix does not claim that all signed builds were missing. Proposed stacked PR source commits still require exact matching executed signed build evidence, protected staging recovery and full independent review; this draft cannot certify them.

**Three disciplines:** ENGINEER: bounded CLI negative tests PASS, positive clean preview/production pending exact post-commit. CYBERSECURITY: forged/malformed/dirty release label rejected under draft source; no attacker exploit or signed production approval claimed. REVIEWER: AI checked real source behavior and unmodified existing OIDC workflow; no external agency or owner approval.

**NEXT:** guard-commit draft, run exact clean-Git-HEAD positive preview and production assertions, inspect all gates, retain raw SHA receipts and review before any approved app candidate repin.
