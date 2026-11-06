# Retained historical test evidence

These 136 original test artifacts were copied without changing their bytes from the previous QA worktree. `manifest.json` records a SHA-256 digest for each file. The scenario reconciler checks both file presence and hashes.

**Historical, scoped evidence is not current-release certification.** The original tested code SHAs remain pinned in `scripts/reconcile-current-masterplan-scenarios.mjs`. Passing a previous Chromium or native test never upgrades a whole Masterplan scenario to certified status or proves external providers, production security, or deployment readiness.

Do not replace prior logs with later test results. Capture new tests separately with their actual source SHA and audit provenance.
