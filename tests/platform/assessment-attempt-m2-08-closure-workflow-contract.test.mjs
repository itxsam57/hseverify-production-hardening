import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const exactPullRequestHead = /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha\s*\}\}/;

async function readRequired(relativePath) {
  try {
    return await readFile(new URL(relativePath, root), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      assert.fail(`M2.08 closure workflow is missing required file: ${relativePath}`);
    }
    throw error;
  }
}

for (const [label, path] of [
  ["M2.08 real browser QA", ".github/workflows/m2-08-browser.yml"],
  ["M2.07 real browser QA", ".github/workflows/m2-07-browser.yml"],
  ["Independent full-system audit", ".github/workflows/independent-full-system-audit.yml"]
]) {
  test(`${label} checks out the exact PR head instead of GitHub's synthetic merge ref`, async () => {
    const workflow = await readRequired(path);
    assert.match(
      workflow,
      exactPullRequestHead,
      `${label} must use pull_request.head.sha on PR runs and github.sha on push/manual runs.`
    );
  });
}
