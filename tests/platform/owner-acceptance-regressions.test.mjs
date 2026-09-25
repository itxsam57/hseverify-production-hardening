import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("verified Worker profile accepts only the same-account provisional-to-permanent Worker ID transition", async () => {
  const profile = await source("src/lib/worker/profile-service.ts");
  assert.match(profile, /record\.workerSub !== identity\.sub/);
  assert.match(profile, /record\.workerId\.startsWith\("HSE-REG-"\)/);
  assert.match(profile, /identity\.workerId\.startsWith\("worker_id_"\)/);
  assert.match(profile, /permanentIdUpgrade \? \{ \.\.\.record, workerId: identity\.workerId \} : record/);
  assert.match(profile, /if \(!sameWorkerId && !permanentIdUpgrade\)/);
});

test("Admin Question Bank example is a placeholder, not a default value that can overwrite early user input", async () => {
  const page = await source("src/app/admin/(portal)/question-bank/page.tsx");
  assert.match(page, /textarea name="versionPayload" required rows=\{16\} placeholder=\{EXAMPLE\}/);
  assert.doesNotMatch(page, /textarea name="versionPayload" required rows=\{16\} defaultValue=\{EXAMPLE\}/);
});