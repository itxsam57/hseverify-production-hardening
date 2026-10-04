import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const guard = resolve("scripts/check-public-verification-foundation.mjs");
function runWith(extra = "") {
  const root = mkdtempSync(join(tmpdir(), "hse-public-authority-"));
  try {
    const paths = [...readFileSync(guard, "utf8").matchAll(/"((?:src|database|tests|scripts)\/[^"\n]+\.(?:ts|tsx|sql|mjs))"/g)].map(match => match[1]);
    for (const path of new Set(paths)) cpSync(resolve(path), join(root, path), { recursive: true });
    cpSync(resolve("src/app/verify"), join(root, "src/app/verify"), { recursive: true });
    cpSync(resolve("src/app/contact"), join(root, "src/app/contact"), { recursive: true });
    appendFileSync(join(root, "src/lib/public-verification/public-verification-repository.ts"), extra);
    return spawnSync(process.execPath, [guard], { cwd: root, encoding: "utf8" });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("public projection can read issued credential status", () => {
  const result = runWith();
  assert.equal(result.status, 0, result.stderr);
});
for (const authority of [
  'INSERT INTO credential_issuances (credential_id) VALUES ($1)',
  'UPDATE credential_issuances SET status=$1',
  'DELETE FROM credential_issuances WHERE credential_id=$1',
  'INSERT INTO public.credential_issuances (credential_id) VALUES ($1)',
  'UPDATE "credential_issuances" SET status=$1',
  'DELETE FROM public.credential_issuances WHERE credential_id=$1',
  'issueCredential(principal)',
  'repository.issue(principal)',
]) test(`public boundary rejects workflow mutation: ${authority}`, () => {
  const result = runWith(`\n${authority}\n`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /workflow authority/);
});
