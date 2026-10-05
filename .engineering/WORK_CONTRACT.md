# EF-ASSESSMENT-TIMEOUT-20261005

M2.07.05: accepted Masterplan requires server-authoritative timeout auto-submit and one final outcome. Actual timed begin, saved first answer, expired owned view fails submitted=true at canonical fa57cb7. RED artifact: .autopilot/artifacts/20261005-assessment-timeout-auto-submit-red-fa57cb7.json.

Use existing immutable clocks and durable outbox retries/leases. Timed begin/section start must atomically enqueue expiry. Complete or partial/empty attempts finalize exactly once without fabricating blank answers; scoring includes all pinned items so omissions cannot inflate score and unanswered written items cannot bypass review. Preserve timed section policies, saved responses/revisions, source form/exposures and required audit rollback. Worker-side processing must remain effective after browser closure; actual real producer-to-worker and browser receipt paths required.

Implement the smallest shared finalization path, authenticated owned read refresh and continuous worker entry. All actor/tenant/input boundaries retained; background actor must be truthful system context. No provider, PostgreSQL concurrency, broader accommodation or consumer-readiness certification inferred.

PR20 accepted at08cd920 and mergedfa57cb7 after9exactlocal/5CI/independentACCEPT. Eight approved Company/sandbox-billing rows now promoted:32passed/12partial/174unverified. Prior proof in exact and CI artifacts, retained ledger entries and Git history; do not repeat accepted work except affected regression checks.

Resume: read CURRENT_TASK plus this contract, then guard receipt and exact next action. Canonical post-merge CI may run on dedicated runner; do not overlap local Next/browser/build with its jobs. Native isolated tests may run independently.

## Bounded prerequisite slice (2026-10-05)
Three database REDs confirmed unanswered-item grading failures. LEFT JOIN all pinned form items fixes partial/empty scoring and written review routing without fabricated responses. Two remaining canonical audit workflows failed before tests for hosted billing; apply the existing reviewed dedicated runner policy and isolated /tmp databases using allowed github job.env context, retaining all gates. Independent bounded review passed; new written assertion excludes FINAL auto-score. This slice does not close timeout or change readiness counts.

## Current timeout verification

Migration0084 and shared system finalization implemented. Actual timed producer,
real child worker process, interrupted expiry, legacy reconciliation, audit-failure
retry/draft retention and empty migration roundtrip pass in16native tests.
Natural90s browser expiry confirms saved MCQ draft, omitted written answer, system
audit and reload receipt. Type/lint/notification and outbox checks pass locally.
No timeout row promoted: exact candidate build/browser/CI and PostgreSQL production
worker remain to verify. PR21 prerequisite merged e445518; keep counts32/12/174.
Next product gap: assigned written reviewer needs all pinned prompts/rubrics and
latest response or explicit unanswered evidence; current queue shows score inputs.

## Assigned review and remaining runner repair

Actual database RED at eef08fb reproduced absent question evidence in assigned
review queue. Source now joins reviewer/case/tenant and pinned form versions,
retains latest revision and explicit omitted items, and renders prompts, answers
and rubrics. Sandbox guidance shares this source and gives omitted responses zero
suggested credit.17begin/source,2pinned/guidance and13written regressions pass;
strict type and lint pass. Browser now exercises expiry through human FAIL and
Reassessment required; actual execution still pending at commit preparation.

PR22 hosted m1-11/m2-01 jobs were rejected before starting by billing. Remaining
obsolete QA cancelled after connected/release passed. Apply the already reviewed
trusted dedicated-runner policy to remaining20workflows, hosted-fork fallback and
isolated temporary DBs; parsed YAML check preserves every step/permission/gate.
No cancelled/refused run counts as pass. Update PR22 and execute actual new CI.
