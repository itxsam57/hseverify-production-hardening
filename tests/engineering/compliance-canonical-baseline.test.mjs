import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Reverting the new-branch baseline to the older default must fail this real workflow drill.
test("new QA branch compliance checks introduced commits against the canonical codebase", () => {
  const workflow = readFileSync(".github/workflows/autopilot-compliance.yml", "utf8");
  const script = workflow.split("        run: |\n")[1].split("\n").map(line => line.slice(10)).join("\n");
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const bin = mkdtempSync(join(tmpdir(), "hse-compliance-python-"));
  const python = spawnSync("which", ["python3"], { encoding: "utf8" }).stdout.trim();
  symlinkSync(python, join(bin, "python"));
  const result = spawnSync("bash", ["-e", "-c", script], { encoding: "utf8", env: {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, EVENT_NAME: "push", BEFORE_SHA: "0".repeat(40),
    PR_BASE_SHA: "", PR_HEAD_SHA: "", HEAD_SHA: head,
    DEFAULT_BRANCH: "qa/hse-production-hardening", CANONICAL_BRANCH: "qa/masterplan-completion-20260926"
  }});
  rmSync(bin, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /AUTOPILOT_V4_CI_COMPLIANT/);
});

// Exercise the actual guard against a new commit lacking cycle attribution.
test("canonical baseline does not admit an unguarded new commit", () => {
  const fixture = mkdtempSync(join(tmpdir(), "hse-compliance-reject-"));
  try {
    const git = (args) => spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
    const clone = spawnSync("git", ["clone", "--shared", "--quiet", process.cwd(), fixture], { encoding: "utf8" });
    assert.equal(clone.status, 0, clone.stderr);
    const base = git(["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(git(["-c", "user.name=Compliance Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "Missing cycle attribution"]).status, 0);
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    const result = spawnSync("python3", [".autopilot/guard.py", "ci", "--root", ".", "--base-sha", base, "--head-sha", head], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /missing or invalid Autopilot-Cycle trailer/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
