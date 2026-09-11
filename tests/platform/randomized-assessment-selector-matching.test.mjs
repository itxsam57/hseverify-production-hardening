import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_ASSESSMENT_SELECTOR_MATCHING_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_SELECTOR_MATCHING_RUNTIME_DIST is required");
const matching = await import(
  pathToFileURL(join(runtime, "assessment-generation", "assessment-selector-matching.js")).href
);
const { allocateBlueprintCandidates } = matching;

const candidate = (id, difficulty, tags = []) => ({
  questionId: `assessment_question_${id.repeat(24)}`,
  questionVersionId: `question_version_${id.repeat(24)}`,
  questionType: "MULTIPLE_CHOICE",
  domainReference: "General Safety",
  difficulty,
  tags
});

const broadThenHard = [
  Object.freeze({ count: 1, questionType: "MULTIPLE_CHOICE", tagsAll: Object.freeze([]) }),
  Object.freeze({ count: 1, questionType: "MULTIPLE_CHOICE", difficulty: "HARD", tagsAll: Object.freeze([]) })
];

test("M2.05 overlapping selectors always find a feasible full allocation instead of starving a narrow selector", () => {
  const hard = candidate("h", "HARD");
  const easy = candidate("e", "EASY");

  for (let index = 0; index < 64; index += 1) {
    const nonceHex = index.toString(16).padStart(64, "0");
    const allocation = allocateBlueprintCandidates(broadThenHard, [hard, easy], nonceHex);
    assert.ok(allocation, `feasible allocation failed for nonce ${nonceHex}`);
    assert.deepEqual(
      allocation.map((entry) => [entry.selectorIndex, entry.candidate.questionId]),
      [
        [0, easy.questionId],
        [1, hard.questionId]
      ]
    );
  }
});

test("M2.05 matching is deterministic for a nonce and never reuses a stable question", () => {
  const selectors = [
    Object.freeze({ count: 2, questionType: "MULTIPLE_CHOICE", tagsAll: Object.freeze(["core"]) }),
    Object.freeze({ count: 1, questionType: "MULTIPLE_CHOICE", difficulty: "HARD", tagsAll: Object.freeze(["core"]) })
  ];
  const candidates = [
    candidate("a", "EASY", ["core"]),
    candidate("b", "MEDIUM", ["core"]),
    candidate("c", "HARD", ["core"]),
    candidate("d", "HARD", ["core"])
  ];
  const nonceHex = "ab".repeat(32);
  const first = allocateBlueprintCandidates(selectors, candidates, nonceHex);
  const second = allocateBlueprintCandidates(selectors, candidates, nonceHex);
  assert.ok(first);
  assert.deepEqual(second, first);
  assert.equal(new Set(first.map((entry) => entry.candidate.questionId)).size, 3);
  assert.deepEqual(first.map((entry) => entry.selectorIndex), [0, 0, 1]);
});

test("M2.05 matching fails closed only when no complete selector allocation exists", () => {
  const onlyHard = candidate("x", "HARD");
  const impossible = [
    Object.freeze({ count: 1, questionType: "MULTIPLE_CHOICE", difficulty: "HARD", tagsAll: Object.freeze([]) }),
    Object.freeze({ count: 1, questionType: "MULTIPLE_CHOICE", difficulty: "HARD", tagsAll: Object.freeze([]) })
  ];
  assert.equal(allocateBlueprintCandidates(impossible, [onlyHard], "cd".repeat(32)), null);
});

test("M2.05 matching enforces domain, type, difficulty and tagsAll filters", () => {
  const selectors = [
    Object.freeze({
      count: 1,
      questionType: "MULTIPLE_CHOICE",
      domainReference: "Permit to Work",
      difficulty: "MEDIUM",
      tagsAll: Object.freeze(["core", "ptw"])
    })
  ];
  const wrongDomain = { ...candidate("p", "MEDIUM", ["core", "ptw"]), domainReference: "General Safety" };
  const correct = { ...candidate("q", "MEDIUM", ["core", "ptw", "extra"]), domainReference: "Permit to Work" };
  const allocation = allocateBlueprintCandidates(selectors, [wrongDomain, correct], "ef".repeat(32));
  assert.ok(allocation);
  assert.equal(allocation[0].candidate.questionId, correct.questionId);
});
