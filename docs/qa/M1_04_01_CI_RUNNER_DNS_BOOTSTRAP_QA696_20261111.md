# CI incident recovery — GitHub hosted-runner Ubuntu apt DNS failure (M1.04.01 PR #86)

Date 2026-11-11. Original PR candidate `696f2b1e1f72b267c64b93ae0102f730df67a614` on `qa/verify-m10401-role-query-20261111`; base QA signed `7c2ed2ed5ce666f2c5ede4c9e7857e3963c84862`.

**Confirmed CI bootstrap RED (not application test failure):** GitHub run IDs `43048789467`, `43048786043`, `43048785350`, `43048785229` had **five Chromium jobs failed** at **`npx playwright install --with-deps chromium`**, before any application browser test executed. Job logs `130619921360`, `130619904784`, `130619899636` independently reported:
- `Temporary failure resolving 'azure.archive.ubuntu.com'`
- `Temporary failure resolving 'archive.ubuntu.com'`
- `Temporary failure resolving 'security.ubuntu.com'`
- `Failed to install browsers` and apt exit 100.

Runners identified Ubuntu `resolute` packages. GitHub **native 3/3** tenant/role isolation, other native checks, and Autopilot Compliance succeeded on that exact PR source SHA; local real Chromium tests had already passed. Browser CI **did not run**, and no release pass can be inferred. Evidence source: GitHub Actions job logs for exact IDs and isolated checkpoint `.autopilot/artifacts/M10401_CI_UBUNTU_APT_DNS_BOOTSTRAP_RED_20261111.log`.

## Focused common-root CI recovery attempt

- Found **14** GitHub Actions YAML files containing **18** Playwright Chromium installation steps, all using `--with-deps`. The option invokes Ubuntu apt downloads even when Node and browser installation would otherwise work, introducing the observed Ubuntu DNS dependency.
- Change precisely `npx playwright install --with-deps chromium` to `npx playwright install chromium` across those 14 workflows. **Preserves actual Chromium installation and every real-browser test.** Nothing is mocked, skipped or replaced by a green assertion; the CI must still launch and complete actual Chromium.
- Local checks: **14/14** workflows parse as YAML, **18/18** browser install steps retained and no old apt-invoking steps; `./node_modules/.bin/playwright install --dry-run chromium` exits 0 and lists the Chromium/headless-shell download URLs; whitespace diff clean. **This does not prove GitHub runner has all browser shared libraries.** Only passing exact new PR SHA CI verifies that.
- If the GitHub runner lacks libraries after eliminating Ubuntu apt, use a pinned official Playwright `v1.62.0-noble` container with browser plus dependencies preinstalled, matching the locked local Playwright version. That is a future contingency, not yet performed or claimed.

## Acceptance remains blocked until verified

**Do not merge PR #86 based on this change alone.** Push guarded new commit; demand all new exact PR-SHA Chromium and native jobs and Autopilot Compliance pass. If green, signed two-parent merge and independent merged-SHA CI across all triggered workflows. All 218 scenario signoff, full API/tenant pentest, genuine external providers, final staged HTTPS, load/restore and owner UAT remain outstanding.

**FULLY VERIFIED 0/218, PENTEST INCOMPLETE, BLOCKED_EXTERNAL ≥10 known, RELEASE NO-GO.**
