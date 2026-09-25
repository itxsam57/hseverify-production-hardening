import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { WrittenScoringService } from "@/lib/scoring/written-scoring-service";
import { getDatabaseClient } from "@/lib/database/database";
import {
  addWrittenScoreRubricMarkAction,
  finalizeWrittenScoreAction,
  saveWrittenScoreDecisionAction
} from "../scoring-actions";

export default async function WrittenScoringQueuePage(): Promise<React.JSX.Element> {
  const actor = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.read"
  });
  const reviews = await new WrittenScoringService(await getDatabaseClient()).listReviewQueue({
    reviewerAccountId: actor.accountId
  });
  const typedReviews = reviews as Array<{
    review_id: string;
    case_id: string;
    score: number | null;
    decision: "PASS" | "FAIL" | "CHANGES_REQUESTED" | null;
    reason: string;
    status: string;
  }>;

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Verifier</p>
          <h1>Written scoring review</h1>
          <p>Rubric decisions remain scoped to the assigned reviewer.</p>
        </div>
      </div>
      {reviews.length === 0 ? (
        <div className="empty-state">
          <h2>No scoring reviews</h2>
          <p>Assigned written scoring reviews appear here.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Score / decision</th>
                <th>Rubric</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {typedReviews.map((review) => {
                const readyToFinalize =
                  review.status === "DRAFT" &&
                  review.score !== null &&
                  review.decision !== null;
                return (
                  <tr key={review.review_id}>
                    <td>
                      {review.case_id}
                      <br />
                      <strong>{review.status}</strong>
                    </td>
                    <td>
                      {review.status === "DRAFT" ? (
                        <form action={saveWrittenScoreDecisionAction} className="content-stack">
                          <input type="hidden" name="reviewId" value={review.review_id} />
                          <label>
                            Score
                            <input
                              name="score"
                              type="number"
                              min="0"
                              max="100"
                              required
                              defaultValue={review.score ?? ""}
                            />
                          </label>
                          <label>
                            Decision
                            <select name="decision" required defaultValue={review.decision ?? ""}>
                              <option value="" disabled>Select decision</option>
                              <option value="PASS">PASS</option>
                              <option value="FAIL">FAIL</option>
                              <option value="CHANGES_REQUESTED">CHANGES REQUESTED</option>
                            </select>
                          </label>
                          <label>
                            Reason
                            <textarea
                              name="reason"
                              required
                              minLength={5}
                              maxLength={4000}
                              defaultValue={review.reason}
                            />
                          </label>
                          <button type="submit">Save scoring decision</button>
                        </form>
                      ) : (
                        <>
                          {review.score ?? "—"} · {review.decision ?? "Pending"}
                        </>
                      )}
                    </td>
                    <td>
                      {review.status === "DRAFT" ? (
                        <form action={addWrittenScoreRubricMarkAction}>
                          <input type="hidden" name="reviewId" value={review.review_id} />
                          <input name="criterion" placeholder="Criterion" required />
                          <input name="mark" type="number" min="0" max="100" required />
                          <button type="submit">Save mark</button>
                        </form>
                      ) : (
                        "Locked"
                      )}
                    </td>
                    <td>
                      {review.status === "DRAFT" ? (
                        <form action={finalizeWrittenScoreAction}>
                          <input type="hidden" name="reviewId" value={review.review_id} />
                          <button type="submit" disabled={!readyToFinalize}>
                            Finalize review
                          </button>
                        </form>
                      ) : (
                        "Finalized"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
