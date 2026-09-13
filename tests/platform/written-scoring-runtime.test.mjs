import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService, createIdentifier } = await loadWrittenScoringRuntime();

function databaseFixture() {
  const reviews = [];
  const calibrations = [];
  const marks = [];
  const conflicts = [];
  return {
    reviews,
    calibrations,
    marks,
    conflicts,
    async query(sql, params) {
      if (sql.includes("INSERT INTO written_score_reviews")) {
        reviews.push({ review_id: params[0], tenant_id: params[1], reviewer_account_id: params[4], status: "DRAFT", attempt_id: params[3] });
        return { rows: [] };
      }
      if (sql.includes("SELECT review_id FROM written_score_reviews")) {
        return { rows: reviews.filter((review) => review.review_id === params[0] && review.reviewer_account_id === params[1] && (!params[2] || review.tenant_id === params[2])) };
      }
      if (sql.includes("INSERT INTO scoring_calibration_events")) {
        calibrations.push(params);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO written_score_rubric_marks")) {
        marks.push(params);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO scoring_conflict_declarations")) {
        conflicts.push(params);
        return { rows: [] };
      }
      if (sql.includes("UPDATE written_score_reviews SET status='FINAL'")) {
        const review = reviews.find((item) => item.review_id === params[0]);
        if (!review || conflicts.some((item) => item[1] === params[0])) return { rows: [] };
        review.status = "FINAL";
        return { rows: [review] };
      }
      if (sql.includes("SELECT review_id,status FROM written_score_reviews")) return { rows: reviews.filter((review) => review.review_id === params[0] && review.status === "FINAL") };
      throw new Error(`Unexpected SQL in runtime fixture: ${sql}`);
    }
  };
}

test("written scoring runtime enforces decisions, persistence and reviewer ownership", async () => {
  const database = databaseFixture();
  const service = new WrittenScoringService(database);
  await service.publish({ tenantId: "tenant_alpha", caseId: "assurance_case_1", attemptId: "attempt_1", reviewerAccountId: "reviewer_1", rubricVersion: "v1", score: 85, decision: "PASS", reason: "Meets requirements" });
  const reviewId = database.reviews[0].review_id;
  await service.addRubricMark({ reviewId, criterion: "Safety", mark: 90, reviewerAccountId: "reviewer_1", tenantId: "tenant_alpha" });
  await service.addCalibration({ reviewId, reviewerAccountId: "reviewer_1", tenantId: "tenant_alpha", note: "Aligned review" });
  assert.equal(database.marks.length, 1);
  assert.equal(database.calibrations.length, 1);
  await assert.rejects(() => service.addRubricMark({ reviewId, criterion: "Safety", mark: 90, reviewerAccountId: "reviewer_2", tenantId: "tenant_alpha" }));
  await service.finalize({ reviewId, reviewerAccountId: "reviewer_1", tenantId: "tenant_alpha" });
  assert.equal(database.reviews[0].status, "FINAL");
});

test("written scoring runtime rejects invalid score decisions", async () => {
  assert.equal(typeof createIdentifier, "function");
  const service = new WrittenScoringService(databaseFixture());
  await assert.rejects(() => service.publish({ tenantId: "tenant_alpha", caseId: "assurance_case_1", attemptId: "attempt_1", reviewerAccountId: "reviewer_1", rubricVersion: "v1", score: 101, decision: "PASS", reason: "Invalid" }));
});
