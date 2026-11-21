# M3.07.01 — Concurrent appeal submission security regression, 2026-11-09

**Release gate:** NO-GO. **FULLY VERIFIED: 0/218.** Source QA baseline `8f07d10d6691e2c87d00fa6a8860bdbf0c22390c`, isolated synthetic localhost PGlite + real Chromium, not staging/PostgreSQL/real providers.

## Scope and result
- With a signed-in Worker and a valid owned credential, first complete a legitimate Worker → independent Admin accepted appeal → Living Record reassessment workflow. Retain original accepted appeal/evidence and immutable event history.
- Then send **eight bounded simultaneous real authenticated HTTP POSTs** with distinct valid sequence IDs and grounds on the **same credential** (no production calls). Expected: one new appeal `HTTP 201`, seven `HTTP 409`; no `500`, exactly one new open appeal in authoritative database and only owned evidence references. The original accepted appeal and three-step audit history must remain unchanged.
- Chromium result, run 1: `[201,409,409,409,409,409,409,409]`, test PASS, `.autopilot/artifacts/20261109-M307-real-worker-8parallel-RED.log` (filename reflects the initial investigative probe; **no vulnerability reproduced**).
- Chromium result, independent run 2: same `[201,409,409,409,409,409,409,409]`, PASS, `.autopilot/artifacts/20261109-M307-race-race-browser-repeat.log`; no 500.
- Strict TypeScript PASS, ESLint exit0 with nine existing unrelated warnings. Log index `.autopilot/artifacts/20261109-M307-race-quality-results.tsv`. Exact test addition `tests/browser/credential-appeal-operational-e2e.browser.test.mjs`.

## Limitations / next
No root security flaw was reproduced by this bounded PGlite test. **PostgreSQL-specific concurrent transaction serialization/uniqueness conflict handling remains NOT TESTED**, since local `127.0.0.1:5432` is not accepting connections and no authorized staging PostgreSQL target was used. Real-provider integrations and the full 218 final staging certifications remain unverified. Reexecute against final protected staging exact SHA with real Postgres and controlled concurrent requests; investigate any `500` rather than assuming success.
