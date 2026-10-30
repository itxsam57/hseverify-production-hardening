import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/masterplan-completion-qa.yml","utf8");
const between=(a,b)=>{
  const start=workflow.indexOf("\n  "+a+":");
  const end=workflow.indexOf("\n  "+b+":",start);
  assert.ok(start>=0&&end>start);
  return workflow.slice(start,end);
};
const shardedSteps=between("connected-browser","release-readiness");
const cohortSteps=workflow.slice(workflow.indexOf("\n  consumer-cohorts:"));
const allTests=/^      - name: ([^\n]+)\n        if: \$\{\{ matrix\.shard == ([1-4]) \}\}/gm;

test("hosted connected-browser splits every real journey into exactly one of four bounded shards",()=>{
  assert.match(shardedSteps,/strategy:[\s\S]*?fail-fast: false[\s\S]*?shard: \[1, 2, 3, 4\]/);
  const steps=[...shardedSteps.matchAll(allTests)].map(m=>({name:m[1],shard:Number(m[2])}));
  const allCommands=shardedSteps.match(/^      - name: /gm)||[];
  assert.equal(steps.length,allCommands.length-3,"Every test step after PDF/Chromium and shared outbox build must be assigned to one shard");
  assert.ok(steps.length>=50,"Do not silently drop previously required browser journeys");
  for(let shard=1;shard<=4;shard++){
    const selected=steps.filter(step=>step.shard===shard);
    assert.ok(selected.length>=12&&selected.length<=16,"Unbalanced or missing hosted browser shard "+shard);
  }
  assert.equal(new Set(steps.map(step=>step.name)).size,steps.length,"No duplicated or discarded browser step");
  assert.match(shardedSteps,/Build compiled outbox worker for isolated browser shards/);
  assert.match(shardedSteps,/HSE_MASTERPLAN_TRANSPORT_AUDIT=true HSE_MASTERPLAN_TRANSPORT_ONLY=true HSE_MASTERPLAN_CONTENT_MODE=COMBINED/,"M2.05 candidate payload privacy regression must run in permanent hosted browser CI");
  assert.match(shardedSteps,/M1\.07 initial identity changes requested revision and resubmission approval\n        if: \$\{\{ matrix\.shard == 2 \}\}\n        run: HSE_INITIAL_IDENTITY_MORE_INFO=true HSE_INITIAL_IDENTITY_MORE_INFO_ONLY=true node --test --test-concurrency=1 tests\/browser\/independent-worker-review-e2e\.browser\.test\.mjs/,"M1.07.04 corrected initial identity must be tested in hosted Chromium");
  assert.match(shardedSteps,/M1\.11 leaving letter replacement preserved exact-employment history and private preview\n        if: \$\{\{ matrix\.shard == 2 \}\}\n        run: node --test --test-concurrency=1 tests\/browser\/m1-11-leaving-letter-replacement-preview\.browser\.test\.mjs/,"M1.11.06 historical letter preview must run in real hosted Chromium");
  assert.match(shardedSteps,/M1\.11 two Worker employments end one without changing the other\n        if: \$\{\{ matrix\.shard == 1 \}\}\n        run: node --test --test-concurrency=1 tests\/browser\/m1-11-multiple-employments\.browser\.test\.mjs/,"M1.11.05 two employment histories and exact end must run on hosted Chromium");
  assert.match(shardedSteps,/M1\.06 Worker replacement keeps versioned private old and new previews\n        if: \$\{\{ matrix\.shard == 1 \}\}\n        run: node --test --test-concurrency=1 tests\/browser\/m1-06-attachment-replacement-preview\.browser\.test\.mjs/,"Worker old/new attachment preview must be permanent hosted Chromium gate");
  assert.match(shardedSteps,/M1\.12 public Worker ID and credential opaque capability privacy and negative boundaries\n        if: \$\{\{ matrix\.shard == 2 \}\}\n        run: HSE_PUBLIC_WORKER_LOOKUP_ONLY=true node --test --test-concurrency=1 tests\/browser\/public-verification-invalid-capability\.browser\.test\.mjs tests\/browser\/independent-worker-review-e2e\.browser\.test\.mjs/,"M1.12.01 must test both real public Worker-ID and credential paths together in hosted Chromium");
  assert.match(shardedSteps,/M1\.11 independently verified skill inactive removes current competency but preserves history\n        if: \$\{\{ matrix\.shard == 4 \}\}\n        run: HSE_INACTIVE_SKILL_ONLY=true node --test --test-concurrency=1 tests\/browser\/independent-worker-review-e2e\.browser\.test\.mjs/,"M1.11.08 inactive approved skill counter must be permanently tested on hosted Chromium");
  assert.match(shardedSteps,/M1\.11 corrected experience scanned attachment and Verifier re-review\n        if: \$\{\{ matrix\.shard == 3 \}\}\n        run: HSE_EXPERIENCE_SCAN_RETRY_ONLY=true node --test --test-concurrency=1 tests\/browser\/independent-worker-review-e2e\.browser\.test\.mjs/,"Experience file scan completion and independent review retry must run in hosted Chromium");
  assert.match(shardedSteps,/M1\.07 Worker incomplete identity submission preserves partial draft and blocks premature verification\n        if: \$\{\{ matrix\.shard == 3 \}\}\n        run: node --test --test-concurrency=1 tests\/browser\/m1-07-incomplete-identity-submission\.browser\.test\.mjs/,"Worker incomplete identity path must run real Chromium in hosted CI");
  assert.match(shardedSteps,/M3\.03 public share link field scopes and neutral invalid expired revoked token denials\n        if: \$\{\{ matrix\.shard == 4 \}\}\n        run: node --test --test-concurrency=1 tests\/browser\/m3-03-scoped-share-links\.browser\.test\.mjs/,"Recipient privacy regression must have a permanent isolated hosted Chromium gate");
});

test("all consumer cohorts are selected exactly once across the four separately hosted jobs",()=>{
  assert.match(cohortSteps,/strategy:[\s\S]*?fail-fast: false[\s\S]*?shard: \[1, 2, 3, 4\]/);
  assert.match(cohortSteps,/run: node scripts\/run-consumer-cohort-browser-tests\.mjs --shard=\$\{\{ matrix\.shard \}\}\/4/);
  const list=(args)=>JSON.parse(execFileSync(process.execPath,["scripts/run-consumer-cohort-browser-tests.mjs",...args,"--list"],{encoding:"utf8"}));
  const original=list([]);
  const chunks=[1,2,3,4].map(shard=>list(["--shard="+shard+"/4"]));
  assert.equal(original.length,24,"Preserve all 24 original consumer cohort browser files");
  assert.deepEqual(chunks.flat().slice().sort(),original.slice().sort(),"Every original cohort must run once across the four shards");
  assert.ok(chunks.every(chunk=>chunk.length===6),"No oversized or empty consumer cohort shard");
});
