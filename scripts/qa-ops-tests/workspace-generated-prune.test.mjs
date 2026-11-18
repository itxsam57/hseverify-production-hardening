import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync, readlinkSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

function execute(cmd, args, cwd) {
  const p = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 30000 });
  assert.equal(p.status, 0, p.stderr || p.stdout);
  return p.stdout;
}
function worktree(root, name, dirty = false) {
  const dir = join(root, name);
  mkdirSync(dir);
  execute("git", ["init", "-q"], dir);
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n.next/\n");
  writeFileSync(join(dir, "evidence.txt"), "irreplaceable evidence\n");
  execute("git", ["add", ".gitignore", "evidence.txt"], dir);
  execute("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "-q", "-m", "fixture"], dir);
  if (dirty) writeFileSync(join(dir, "evidence.txt"), "uncommitted essential evidence\n");
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "generated.bin"), "disposable");
  mkdirSync(join(dir, ".next"));
  writeFileSync(join(dir, ".next", "generated.bin"), "disposable");
  return dir;
}
test("dry-run never destroys ignored modules, build output, or evidence", () => {
  const dir = mkdtempSync(join(process.cwd(), ".autopilot/artifacts/prune-fixture-"));
  try {
    const clean = worktree(dir, "clean");
    const result = spawnSync("python3", ["scripts/qa-workspace-prune.py", "--root", dir, "--older-than-days", "0", "--min-free-gib", "100000", "--json"], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.applied, false);
    assert(report.eligible.some(item => item === "clean/node_modules"));
    assert(existsSync(join(clean, "node_modules", "generated.bin")));
    assert(existsSync(join(clean, ".next", "generated.bin")));
    assert(existsSync(join(clean, "evidence.txt")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("apply prunes only safe generated caches and protects dirty worktrees and referenced symlink targets", () => {
  const dir = mkdtempSync(join(process.cwd(), ".autopilot/artifacts/prune-fixture-"));
  try {
    const clean = worktree(dir, "clean");
    const dirty = worktree(dir, "dirty", true);
    const shared = worktree(dir, "shared");
    const consumer = join(dir, "consumer");
    mkdirSync(consumer);
    symlinkSync(relative(consumer, join(shared, "node_modules")), join(consumer, "node_modules"));
    const result = spawnSync("python3", ["scripts/qa-workspace-prune.py", "--root", dir, "--older-than-days", "0", "--min-free-gib", "100000", "--max-entries", "10", "--apply", "--json"], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.applied, true);
    assert(!existsSync(join(clean, "node_modules")));
    assert(!existsSync(join(clean, ".next")));
    assert(existsSync(join(clean, "evidence.txt")));
    assert(existsSync(join(dirty, "node_modules", "generated.bin")));
    assert(existsSync(join(dirty, "evidence.txt")));
    assert(existsSync(join(shared, "node_modules", "generated.bin")));
    assert(existsSync(join(consumer, "node_modules", "generated.bin")));
    assert(readlinkSync(join(consumer, "node_modules")));
    assert(report.removed.some(path => path === "clean/node_modules"));
    assert(!report.removed.some(path => path.startsWith("dirty/")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
