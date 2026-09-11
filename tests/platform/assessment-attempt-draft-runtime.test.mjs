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
  releaseSha: "m2-08-draft-repository-runtime",
  sessionSecret: "m2-08-draft-repository-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-08-draft-repository-auth-pepper-more-than-thirty-two-characters",
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
      strict: true,
      removeComments: false
    }
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.equal(
    errors.length,
    0,
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")
  );
  const dir = await mkdtemp(join(tmpdir(), "hse-m208-draft-repo-"));
  const output = join(dir, "assessment-attempt-repository.mjs");
  await writeFile(output, compiled.outputText, "utf8");
  try {
    return await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fixture(seed = "draft-repository") {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0043_assessment_attempt_drafts");
  const principal = await seedWorkerPrincipal(db, seed);
  const seeded = await seedInProgressAttempt(db, principal, seed, [
    { questionType: "SHORT_TEXT" }
  ]);
  const { AssessmentAttemptRepository } = await loadRepositoryModule();
  const repository = new AssessmentAttemptRepository(db);
  const attempt = await repository.findOwned(principal.accountId, seeded.attemptId);
  const item = await repository.loadCurrentPinnedItem(principal.accountId, seeded.attemptId);
  assert.ok(attempt);
  assert.ok(item);
  return { db, principal, seeded, repository, attempt, item };
}

function saveInput(attempt, item, overrides = {}) {
  return {
    attempt,
    item,
    value: { textValue: "  first unsaved draft  ", booleanValue: null },
    expectedRevision: null,
    mutationKey: "m208-draft-runtime-0001",
    now: ATTEMPT_NOW,
    ...overrides
  };
}

test("M2.08 draft repository round-trips first save, update, clear, idempotent retry, and safe projection", async () => {
  const state = await fixture("draft-repository-roundtrip");
  try {
    assert.equal(
      typeof state.repository.findCurrentDraft,
      "function",
      "findCurrentDraft repository primitive is missing"
    );
    assert.equal(
      typeof state.repository.saveCurrentDraftCompareAndSwap,
      "function",
      "saveCurrentDraftCompareAndSwap repository primitive is missing"
    );
    assert.equal(
      typeof state.repository.deleteCurrentDraft,
      "function",
      "deleteCurrentDraft repository primitive is missing"
    );

    assert.equal(await state.repository.findCurrentDraft(state.attempt, state.item), null);

    const firstInput = saveInput(state.attempt, state.item);
    const first = await state.repository.saveCurrentDraftCompareAndSwap(firstInput);
    assert.equal(first.kind, "saved");
    assert.equal(first.draft.revision, 1);
    assert.deepEqual(first.draft.value, {
      textValue: "  first unsaved draft  ",
      booleanValue: null
    });
    const firstJson = JSON.stringify(first.draft);
    assert.equal(/mutation.*(key|digest)/i.test(firstJson), false);

    const secondInput = saveInput(state.attempt, state.item, {
      value: { textValue: "", booleanValue: null },
      expectedRevision: 1,
      mutationKey: "m208-draft-runtime-0002"
    });
    const second = await state.repository.saveCurrentDraftCompareAndSwap(secondInput);
    assert.equal(second.kind, "saved");
    assert.equal(second.draft.revision, 2);
    assert.deepEqual(second.draft.value, { textValue: "", booleanValue: null });

    const retry = await state.repository.saveCurrentDraftCompareAndSwap(secondInput);
    assert.equal(retry.kind, "saved");
    assert.deepEqual(retry.draft, second.draft);

    const stored = await state.db.query(
      `SELECT text_value,boolean_value,revision,latest_mutation_key,latest_mutation_digest
       FROM assessment_attempt_drafts
       WHERE attempt_id=$1`,
      [state.attempt.attemptId]
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].text_value, "");
    assert.equal(stored.rows[0].boolean_value, null);
    assert.equal(Number(stored.rows[0].revision), 2);
    assert.equal(stored.rows[0].latest_mutation_key, secondInput.mutationKey);
    assert.match(String(stored.rows[0].latest_mutation_digest), /^[a-f0-9]{64}$/);
  } finally {
    await state.db.close();
  }
});

test("M2.08 draft repository fails closed for stale revision and mutation-key reuse without overwriting", async () => {
  const state = await fixture("draft-repository-conflict");
  try {
    const first = await state.repository.saveCurrentDraftCompareAndSwap(
      saveInput(state.attempt, state.item)
    );
    assert.equal(first.kind, "saved");
    const currentInput = saveInput(state.attempt, state.item, {
      value: { textValue: "current accepted", booleanValue: null },
      expectedRevision: 1,
      mutationKey: "m208-draft-runtime-current-0002"
    });
    const current = await state.repository.saveCurrentDraftCompareAndSwap(currentInput);
    assert.equal(current.kind, "saved");
    assert.equal(current.draft.revision, 2);

    const stale = await state.repository.saveCurrentDraftCompareAndSwap(
      saveInput(state.attempt, state.item, {
        value: { textValue: "stale overwrite", booleanValue: null },
        expectedRevision: 1,
        mutationKey: "m208-draft-runtime-stale-0001"
      })
    );
    assert.equal(stale.kind, "conflict");
    assert.equal(stale.current?.revision, 2);
    assert.equal(stale.current?.value.textValue, "current accepted");

    const reused = await state.repository.saveCurrentDraftCompareAndSwap(
      saveInput(state.attempt, state.item, {
        value: { textValue: "different body same key", booleanValue: null },
        expectedRevision: 1,
        mutationKey: currentInput.mutationKey
      })
    );
    assert.equal(reused.kind, "conflict");
    assert.equal(reused.current?.revision, 2);
    assert.equal(reused.current?.value.textValue, "current accepted");

    const stored = await state.repository.findCurrentDraft(state.attempt, state.item);
    assert.equal(stored?.revision, 2);
    assert.equal(stored?.value.textValue, "current accepted");
  } finally {
    await state.db.close();
  }
});

test("M2.08 deleteCurrentDraft requires exact attempt/current-item lineage", async () => {
  const state = await fixture("draft-repository-delete");
  try {
    await state.repository.saveCurrentDraftCompareAndSwap(
      saveInput(state.attempt, state.item)
    );
    const wrongItem = { ...state.item, questionVersionId: `${state.item.questionVersionId}-stale` };
    assert.equal(await state.repository.deleteCurrentDraft(state.attempt, wrongItem), false);
    assert.ok(await state.repository.findCurrentDraft(state.attempt, state.item));
    assert.equal(await state.repository.deleteCurrentDraft(state.attempt, state.item), true);
    assert.equal(await state.repository.findCurrentDraft(state.attempt, state.item), null);
  } finally {
    await state.db.close();
  }
});
