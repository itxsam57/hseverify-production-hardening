import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService } = await loadWrittenScoringRuntime();

test("written scoring production service executes final review workflow with stored state", async () => {
  const state = { review: null, calibration: [], marks: [] };
  const database = {
    async query(sql, params) {
      if (sql.includes("INSERT INTO written_score_reviews")) {
        state.review = { id: params[0], reviewer: params[4], tenant: params[1], status: "DRAFT" };
        return { rows: [] };
      }
      if (sql.includes("SELECT review_id FROM written_score_reviews")) {
        return { rows: state.review && state.review.id === params[0] && state.review.reviewer === params[1] && state.review.tenant === params[2] ? [{ review_id: state.review.id }] : [] };
      }
      if (sql.includes("INSERT INTO written_score_rubric_marks")) {
        state.marks.push(params);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO scoring_calibration_events")) {
        state.calibration.push(params);
        return { rows: [] };
      }
      if (sql.includes("UPDATE written_score_reviews SET status='FINAL'")) {
        state.review.status = "FINAL";
        return { rows: [{ review_id: state.review.id }] };
      }
      if (sql.includes("SELECT review_id,status FROM written_score_reviews")) {
        return { rows: [{ review_id: state.review.id, status: state.review.status }] };
      }
      throw new Error(`Unexpected runtime query: ${sql}`);
    }
  };

  const service = new WrittenScoringService(database);
  await service.publish({ tenantId: "tenant_alpha", caseId: "assurance_case_1", attemptId: "attempt_1", reviewerAccountId: "reviewer_1", rubricVersion: "v1", score: 90, decision: "PASS", reason: "Meets written scoring requirements" });
  await service.addRubricMark({ reviewId: state.review.id, criterion: "Safety", mark: 90, reviewerAccountId: "reviewer_1", tenantId: "tenant_alpha" });
  await service.addCalibration({ reviewId: state.review.id, reviewerAccountId: "reviewer_1", tenantId: "tenant_alpha", note: "Calibration aligned" });
  const final = await service.finalize({ reviewId: state.review.id, reviewerAccountId: "reviewer_1", tenantId: "tenant_alpha" });

  assert.equal(final.status, "FINAL");
  assert.equal(state.marks.length, 1);
  assert.equal(state.calibration.length, 1);
});
