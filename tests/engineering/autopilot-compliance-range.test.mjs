import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ZERO = "0".repeat(40);
const canonicalRef = "refs/remotes/origin/qa/masterplan-completion-20260926";
const qaRef = "refs/heads/qa/a28-eligibility-read-guard-20261107";
// Execute the workflow's actual range selection, stopping before the unchanged
// guard invocation. Temporary real Git ancestry distinguishes safe baselines
// from unrelated or missing canonical history without mocking Git.
const workflow = readFileSync(".github/workflows/autopilot-compliance.yml", "utf8");
const block = workflow.split("        run: |\n")[1];
assert.ok(block, "Compliance workflow must expose its guarded run block.");
const lines = block.split("\n").map(line => line.slice(10));
const guardLine = lines.findIndex(line => line.startsWith("python .autopilot/guard.py ci "));
assert.ok(guardLine >= 0, "Actual guard invocation must remain present.");
const selection = lines.slice(0, guardLine).join("\n") + '\nprintf "%s\\n%s\\n" "$base" "$head"\n';

function graph() {
  const cwd = mkdtempSync(join(tmpdir(), "hse-compliance-range-"));
  const git = (...args) => {
    const result = spawnSync("git", args, {cwd, encoding:"utf8"});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet");
  git("config", "user.name", "Range Fixture");
  git("config", "user.email", "range@example.invalid");
  git("remote", "add", "origin", cwd);
  const commit = label => {git("commit", "--quiet", "--allow-empty", "-m", label);return git("rev-parse","HEAD");};
  const root = commit("Original branch before");
  const canonical = commit("Established canonical imported merge");
  git("update-ref",canonicalRef,canonical);
  const head = commit("New guarded candidate");
  const select = (before=root, overrides={}) => {
    const result = spawnSync("bash", ["-e", "-c", selection], {cwd, encoding:"utf8", env:{
      ...process.env, EVENT_NAME:"push", BEFORE_SHA:before, HEAD_SHA:head,
      PR_BASE_SHA:"", PR_HEAD_SHA:"", CANONICAL_BRANCH:"qa/masterplan-completion-20260926", VERIFIED_QA_BRANCH:"qa/a28-eligibility-read-guard-20261107", ...overrides
    }});
    assert.equal(result.status,0,result.stdout+result.stderr);
    return result.stdout.trim().split("\n");
  };
  return {cwd,git,commit,root,canonical,head,select,cleanup:()=>rmSync(cwd,{recursive:true,force:true})};
}

test("existing feature push excludes only imported established canonical ancestors",()=>{
 const g=graph();try{assert.deepEqual(g.select(),[g.canonical,g.head]);}finally{g.cleanup();}
});
test("pull request retains its exact event base and head",()=>{
 const g=graph();try{assert.deepEqual(g.select(g.root,{EVENT_NAME:"pull_request",PR_BASE_SHA:g.root,PR_HEAD_SHA:g.head}),[g.root,g.head]);}finally{g.cleanup();}
});
test("missing canonical retains original push range",()=>{
 const g=graph();try{g.git("update-ref","-d",canonicalRef);assert.deepEqual(g.select(),[g.root,g.head]);}finally{g.cleanup();}
});
test("diverging previous branch tip cannot be concealed by canonical baseline",()=>{
 const g=graph();try{g.git("checkout","--quiet","--detach",g.root);const other=g.commit("Diverging previous destination");assert.deepEqual(g.select(other),[other,g.head]);}finally{g.cleanup();}
});
test("canonical outside candidate ancestry cannot advance push baseline",()=>{
 const g=graph();try{g.git("checkout","--quiet","--detach",g.root);const other=g.commit("Unmerged canonical");g.git("update-ref",canonicalRef,other);assert.deepEqual(g.select(),[g.root,g.head]);}finally{g.cleanup();}
});
test("canonical equal to candidate keeps candidate in the guarded range",()=>{
 const g=graph();try{g.git("update-ref",canonicalRef,g.head);assert.deepEqual(g.select(),[g.root,g.head]);}finally{g.cleanup();}
});
test("new branch uses canonical merge base when candidate extends canonical",()=>{
 const g=graph();try{assert.deepEqual(g.select(ZERO),[g.canonical,g.head]);}finally{g.cleanup();}
});
test("new branch at canonical head retains zero baseline so guard checks head",()=>{
 const g=graph();try{g.git("update-ref",canonicalRef,g.head);assert.deepEqual(g.select(ZERO),[ZERO,g.head]);}finally{g.cleanup();}
});
test("new branch with missing canonical retains zero baseline",()=>{
 const g=graph();try{g.git("update-ref","-d",canonicalRef);assert.deepEqual(g.select(ZERO),[ZERO,g.head]);}finally{g.cleanup();}
});


test("first new-branch push uses current trusted QA release ancestor, not imported pre-guard legacy",()=>{
 const g=graph();try{
   g.git("checkout","--quiet","--detach",g.canonical);
   const qaTip=g.commit("Signed GitHub approved QA release");
   g.git("update-ref",qaRef,qaTip);
   const candidate=g.commit("New guarded QA feature");
   assert.deepEqual(g.select(ZERO,{HEAD_SHA:candidate}),[qaTip,candidate]);
 }finally{g.cleanup();}
});
test("unrelated trusted QA ref cannot hide a new branch's own candidate commits",()=>{
 const g=graph();try{
   g.git("checkout","--quiet","--detach",g.root);
   const unrelated=g.commit("Diverged unrelated QA");
   g.git("update-ref",qaRef,unrelated);
   assert.deepEqual(g.select(ZERO),[g.canonical,g.head]);
 }finally{g.cleanup();}
});
test("QA release behind canonical baseline cannot replace it on a first branch push",()=>{
 const g=graph();try{
   g.git("update-ref",qaRef,g.root);
   assert.deepEqual(g.select(ZERO),[g.canonical,g.head]);
 }finally{g.cleanup();}
});
test("QA ref equal to candidate cannot exclude the candidate itself",()=>{
 const g=graph();try{
   g.git("update-ref",qaRef,g.head);
   assert.deepEqual(g.select(ZERO),[g.canonical,g.head]);
 }finally{g.cleanup();}
});
test("QA candidate boundary cannot override pull request or existing-branch push event bounds",()=>{
 const g=graph();try{
   g.git("checkout","--quiet","--detach",g.canonical);
   const qaTip=g.commit("Signed GitHub QA");
   g.git("update-ref",qaRef,qaTip);
   const candidate=g.commit("Guarded feature");
   assert.deepEqual(g.select(ZERO,{EVENT_NAME:"pull_request",PR_BASE_SHA:g.root,PR_HEAD_SHA:candidate}),[g.root,candidate]);
   assert.deepEqual(g.select(g.root,{HEAD_SHA:candidate}),[g.canonical,candidate]);
 }finally{g.cleanup();}
});
test("first-branch QA boundary leaves all extra branch commits in the guard range",()=>{
 const g=graph();try{
   g.git("checkout","--quiet","--detach",g.canonical);
   const qaTip=g.commit("Signed QA release");
   g.git("update-ref",qaRef,qaTip);
   g.commit("Untrusted extra commit one");
   const tip=g.commit("Untrusted extra commit two");
   assert.deepEqual(g.select(ZERO,{HEAD_SHA:tip}),[qaTip,tip]);
   assert.equal(g.git("rev-list","--count",qaTip+".."+tip),"2");
 }finally{g.cleanup();}
});
