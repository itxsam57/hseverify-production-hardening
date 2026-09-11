import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import {
  ATTEMPT_NOW,
  seedInProgressAttempt,
  seedWorkerPrincipal
} from "../helpers/assessment-attempt-fixture.mjs";

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-08-draft-concurrency-runtime",
  sessionSecret: "m2-08-draft-concurrency-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-08-draft-concurrency-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function loadRepositoryModule() {
  const path = resolve("src/lib/assessment-attempt/assessment-attempt-repository.ts");
  let raw = await readFile(path, "utf8");
  raw = raw.replace(/^import "server-only";\r?\n\r?\n?/, "");
  const compiled = ts.transpileModule(raw, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      strict: true
    }
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.equal(errors.length, 0);
  const dir = await mkdtemp(join(tmpdir(), "hse-m208-draft-race-"));
  const output = join(dir, "assessment-attempt-repository.mjs");
  await writeFile(output, compiled.outputText, "utf8");
  try {
    return await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fixture(seed) {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0043_assessment_attempt_drafts");
  const principal = await seedWorkerPrincipal(db, seed);
  const seeded = await seedInProgressAttempt(db, principal, seed, [
    { questionType: "LONG_TEXT" }
  ]);
  const { AssessmentAttemptRepository } = await loadRepositoryModule();
  const repository = new AssessmentAttemptRepository(db);
  const attempt = await repository.findOwned(principal.accountId, seeded.attemptId);
  const item = await repository.loadCurrentPinnedItem(principal.accountId, seeded.attemptId);
  assert.ok(attempt);
  assert.ok(item);
  return { db, repository, attempt, item };
}

function input(attempt, item, value, expectedRevision, mutationKey) {
  return {
    attempt,
    item,
    value: { textValue: value, booleanValue: null },
    expectedRevision,
    mutationKey,
    now: ATTEMPT_NOW
  };
}

test("M2.08 concurrent first draft writes produce one revision-one winner and one controlled conflict", async () => {
  const state = await fixture("draft-race-first");
  try {
    assert.equal(typeof state.repository.saveCurrentDraftCompareAndSwap, "function");
    const results = await Promise.all([
      state.repository.saveCurrentDraftCompareAndSwap(
        input(state.attempt, state.item, "first writer", null, "m208-race-first-writer-0001")
      ),
      state.repository.saveCurrentDraftCompareAndSwap(
        input(state.attempt, state.item, "second writer", null, "m208-race-second-writer-0001")
      )
    ]);
    assert.deepEqual(
      results.map((result) => result.kind).sort(),
      ["conflict", "saved"]
    );
    const stored = await state.repository.findCurrentDraft(state.attempt, state.item);
    assert.equal(stored?.revision, 1);
    assert.ok(stored?.value.textValue === "first writer" || stored?.value.textValue === "second writer");
  } finally {
    await state.db.close();
  }
});

test("M2.08 concurrent writers from one revision serialize to one increment and one conflict", async () => {
  const state = await fixture("draft-race-update");
  try {
    const first = await state.repository.saveCurrentDraftCompareAndSwap(
      input(state.attempt, state.item, "base", null, "m208-race-base-write-0001")
    );
    assert.equal(first.kind, "saved");
    assert.equal(first.draft.revision, 1);

    const results = await Promise.all([
      state.repository.saveCurrentDraftCompareAndSwap(
        input(state.attempt, state.item, "writer A", 1, "m208-race-update-writer-a-0001")
      ),
      state.repository.saveCurrentDraftCompareAndSwap(
        input(state.attempt, state.item, "writer B", 1, "m208-race-update-writer-b-0001")
      )
    ]);
    assert.deepEqual(
      results.map((result) => result.kind).sort(),
      ["conflict", "saved"]
    );
    const stored = await state.repository.findCurrentDraft(state.attempt, state.item);
    assert.equal(stored?.revision, 2);
    assert.ok(stored?.value.textValue === "writer A" || stored?.value.textValue === "writer B");
  } finally {
    await state.db.close();
  }
});

test("M2.08 stale delayed mutation cannot overwrite the newer accepted draft", async () => {
  const state = await fixture("draft-race-delayed");
  try {
    const first = await state.repository.saveCurrentDraftCompareAndSwap(
      input(state.attempt, state.item, "base", null, "m208-race-delayed-base-0001")
    );
    assert.equal(first.kind, "saved");
    const newer = await state.repository.saveCurrentDraftCompareAndSwap(
      input(state.attempt, state.item, "newer", 1, "m208-race-delayed-newer-0001")
    );
    assert.equal(newer.kind, "saved");
    assert.equal(newer.draft.revision, 2);

    const delayed = await state.repository.saveCurrentDraftCompareAndSwap(
      input(state.attempt, state.item, "older delayed", 1, "m208-race-delayed-older-0001")
    );
    assert.equal(delayed.kind, "conflict");
    assert.equal(delayed.current?.revision, 2);
    assert.equal(delayed.current?.value.textValue, "newer");
  } finally {
    await state.db.close();
  }
});
