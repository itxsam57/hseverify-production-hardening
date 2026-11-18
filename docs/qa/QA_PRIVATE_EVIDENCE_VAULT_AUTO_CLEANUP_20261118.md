# HSE Verify — automatic private evidence backup and verified cleanup (2026-11-18)

## Status and scope

- Original release still **NO-GO — 0/218 FULLY_VERIFIED**. This infrastructure change makes historical scoped QA receipts more durable; it **does not certify any Masterplan scenario or independent pentest slot**.
- Private vault: **itxsam57/hseverify-qa-evidence-vault** (verified GitHub `private=true`; do **not** change visibility or copy raw logs to the public product repo).
- Canonical product source: **itxsam57/hseverify-production-hardening**, signed release QA branch `qa/a28-eligibility-read-guard-20261107`.
- Real safety proof: the first private vault release `qa-raw-6c774dbee5ee8a3910f28d6c8e55314b` was uploaded, downloaded, SHA256-verified, **19 matching local raw files removed only afterward**, and all 19 were independently restored from the private GitHub release. A second 12-worktree pass verified **341 backed-up files and deleted 35 only from GitHub-backed clean idle source SHA worktrees**. Dirty/working evidence remains local.

## What the six-hour janitor does

1. Check the private GitHub vault exists and is private; scan aged (24h+) raw files only under existing `.autopilot/artifacts/` in source worktrees. Never include `.git`, `node_modules`, `.next`, audit chain, the 218-row ledger, tests/source, PostgreSQL, active process worktrees, outside symlinks, or paths outside the authorized workspace.
2. Refuse automatic transfer of files containing known credential indicators. Treat all historical data as **synthetic-only**; do not send actual user PII or production secrets. Credential scanning is a guard, not a guarantee of complete secret detection.
3. Build a private GitHub Release per unique worktree content-addressed manifest. The manifest identifies every raw file SHA256, size, mtime, source code SHA, and original relative path. Download the real uploaded archive and **verify exact byte hash and every archived file against its manifest**. If GitHub upload/download or hashes fail: delete nothing.
4. **Prune individual original files only when all conditions hold:** remote private snapshot verified, original worktree fully clean, no active process inside it, exact source commit independently retrievable from GitHub, and each local file still matches its backed-up size/mtime/content SHA256. Dirty worktrees receive a verified backup but **zero deletion** until their changes are committed and pushed.
5. Remove old disposable top-level `node_modules` and `.next` **only after exact source SHA is present on GitHub**, while preserving current shared dependency installations, dirty worktrees, active processes and other non-disposable data. This is separate from archiving raw test receipts; regenerable caches do not require raw-evidence backups.
6. A local checksum-based scheduling index prevents repeatedly backing up the same unchanged dirty evidence and starving later worktrees. **The private GitHub releases remain the authoritative copies; a local index alone never authorizes deletion.**

The schedule is `ops/systemd/hseverify-qa-evidence-janitor.timer`: every 6 hours with persistent missed-run catchup, 16 worktrees per evidence cycle, 16 generated cache entries per cycle. Files not backed up remain locally protected, even if the disk is low. Both commands are dry-run by default except when explicitly passed `--apply` in the reviewed service unit.

## Commands

- Review without cleanup: `npm run qa:archive-evidence-dry-run` and `npm run qa:workspace-health`.
- Explicit archive with private byte-by-byte verification: `npm run qa:archive-evidence-verified`.
- Full regression safety checks: `npm run qa:archive-evidence-regressions` and `npm run qa:ops-regressions`.
- Restore safely on demand without overwriting existing working files:
  `python3 scripts/qa-verified-evidence-vault.py --restore-release <qa-raw-tag> --restore-dir /home/ubuntu/work/qa-restored-evidence`.
- Inspect: `sudo systemctl status hseverify-qa-evidence-janitor.timer`; `sudo journalctl -u hseverify-qa-evidence-janitor.service -n 60 --no-pager`; `gh release list --repo itxsam57/hseverify-qa-evidence-vault`.
- GitHub Release archives do not have CI artifacts' 90-day automatic expiration; nevertheless treat retention and vault access as owner-governed, not as an unconditional disaster-recovery guarantee.

## Remaining backlog

- Old uncommitted worktree source/audit changes must be committed, reviewed and pushed before local deletion. Vaulting ignored receipts alone is **not** a substitute for preserving those changes.
- Real final protected stage, providers, independently complete full pentest, realistic load/restore and Owner UAT are still required before any original scenario gets `FULLY_VERIFIED`.
- Do not delete the whole legacy worktree, historical raw-evidence ledger or the active M1.11.03 Skill Review worktree. Only the allowlisted generated files with all safety gates may be pruned.
