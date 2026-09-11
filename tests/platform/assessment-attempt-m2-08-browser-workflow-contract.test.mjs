import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const scriptPath = "scripts/m2-08-browser-qa.mjs";
const workflowPath = ".github/workflows/m2-08-browser.yml";

function read(path) {
  assert.ok(existsSync(path), `Required M2.08 real-browser file is missing: ${path}`);
  return readFileSync(path, "utf8");
}

const scenarioNames = [
  "save acknowledged draft",
  "reload exact draft",
  "fresh context server recovery",
  "no browser persistence",
  "save and exit",
  "resume in progress",
  "failed save blocks normal exit",
  "emergency exit is bounded",
  "same revision tab conflict",
  "explicit conflict resolution",
  "next commits and advances once",
  "delayed old autosave rejected",
  "final submit clears draft",
  "cross worker access denied",
  "browser payload secrecy",
  "partial numeric draft round trip",
  "clean browser console"
];

test("M2.08 browser workflow checks out and executes the exact commit with retained evidence", () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /name:\s*M2\.08 real browser QA/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /feat\/m2-08-answer-recovery/);
  assert.match(workflow, /uses:\s*actions\/checkout@v6[\s\S]*?ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.match(workflow, /npm run test:m2-08/);
  assert.match(workflow, /playwright@1\.55\.0/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /node scripts\/m2-08-browser-qa\.mjs --seed-only/);
  assert.match(workflow, /node scripts\/m2-08-browser-qa\.mjs/);
  assert.match(workflow, /upload-artifact@v4/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /m2-08-browser-\$\{\{\s*github\.sha\s*\}\}/);
  assert.match(workflow, /server\.log/);
  assert.match(workflow, /traffic-summary\.json/);
  assert.match(workflow, /results\.json/);
});

test("M2.08 browser harness executes every required journey instead of satisfying coverage with marker strings", () => {
  const script = read(scriptPath);

  assert.match(script, /from\s+["']playwright["']/);
  assert.match(script, /chromium\.launch/);
  assert.match(script, /openScriptDatabase/);
  assert.match(script, /--seed-only/);
  assert.match(script, /const\s+scenarios\s*=\s*\[/);
  assert.match(script, /for\s*\(const\s+scenario\s+of\s+scenarios\)/);
  assert.match(script, /await\s+checkpoint\(scenario\.name,\s*scenario\.run\)/);

  for (const name of scenarioNames) {
    assert.ok(script.includes(`name: "${name}"`), `Browser harness must execute scenario: ${name}`);
  }

  assert.match(script, /page\.on\(["']console["']/);
  assert.match(script, /page\.on\(["']pageerror["']/);
  assert.match(script, /localStorage/);
  assert.match(script, /indexedDB/);
  assert.match(script, /caches/);
  assert.match(script, /caret:\s*["']initial["']/);
  assert.match(script, /traffic-summary\.json/);
  assert.doesNotMatch(script, /requiredCheckpoints|coverageMarkers|checkpointNames/);
});
