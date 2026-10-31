# GitHub Actions CI runner recovery (2026-10-30)

On QA commit `9a77ffa`, most GitHub checks were queued, not failed. The repository variable `HSE_CI_RUNNER_LABEL` was `hseverify-qa`, but the only matching repository Actions runner (`hseverify-qa-vps`, Linux X64) reported `offline`. The separately pinned GitHub-hosted `postgres-json` job passed.

The actual repository Actions variable was changed through authenticated GitHub API to **`ubuntu-24.04`**. Workflow `runs-on` selectors use this variable for in-repository PRs/pushes, while fork PRs retain their hosted fallback. A fixed hosted image also avoids the untested OS change from `ubuntu-latest`. No long-lived repo token or personal workstation runner should be installed to make this fix.

Inspect with:

```bash
gh api repos/itxsam57/hseverify-production-hardening/actions/variables/HSE_CI_RUNNER_LABEL --jq '{name,value}'
gh api repos/itxsam57/hseverify-production-hardening/actions/runners --jq '.runners[] | {name,status,labels:[.labels[].name]}'
gh pr checks 37 --repo itxsam57/hseverify-production-hardening
```

**Acceptance still open:** observe newly triggered jobs actually start on GitHub-hosted Ubuntu 24.04 and finish, distinguish GitHub queue/backlog from test failures, and protect the exact QA/release SHA. Older queued jobs may not dynamically adopt a changed runner variable. Do not claim green checks until GitHub posts completed results.
