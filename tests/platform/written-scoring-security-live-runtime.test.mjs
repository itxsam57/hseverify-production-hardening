import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService } = await loadWrittenScoringRuntime();

test("written scoring live runtime keeps review queue tenant isolation", async () => {
  const database = { async query(sql, params) { if (sql.includes("WHERE tenant_id=$1 AND status='DRAFT'")) return { rows: params[0] === "tenant_alpha" ? [{ review_id: "written_score_one" }] : [] }; throw new Error(`Unexpected runtime query: ${sql}`); } };
  const service = new WrittenScoringService(database);
  assert.deepEqual(await service.listReviewQueue({ tenantId: "tenant_alpha" }), [{ review_id: "written_score_one" }]);
  assert.deepEqual(await service.listReviewQueue({ tenantId: "tenant_other" }), []);
});
