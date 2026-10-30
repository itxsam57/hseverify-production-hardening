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
