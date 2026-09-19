import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { WrittenScoringService } from "@/lib/scoring/written-scoring-service";
import { getDatabaseClient } from "@/lib/database/database";
import { addWrittenScoreRubricMarkAction, finalizeWrittenScoreAction } from "../scoring-actions";

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
    score: number;
    decision: string;
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
            <thead><tr><th>Case</th><th>Score</th><th>Decision</th><th>Status</th><th>Rubric</th><th>Action</th></tr></thead>
            <tbody>
              {typedReviews.map((review) => (
                <tr key={review.review_id}>
                  <td>{review.case_id}</td><td>{review.score}</td><td>{review.decision}</td><td>{review.status}</td>
                  <td>
                    {review.status === "DRAFT" ? (
                      <form action={addWrittenScoreRubricMarkAction}>
                        <input type="hidden" name="reviewId" value={review.review_id} />
                        <input name="criterion" placeholder="Criterion" />
                        <input name="mark" type="number" min="0" max="100" />
                        <button type="submit">Save mark</button>
                      </form>
                    ) : "Locked"}
                  </td>
                  <td>
                    {review.status === "DRAFT" ? (
                      <form action={finalizeWrittenScoreAction}>
                        <input type="hidden" name="reviewId" value={review.review_id} />
                        <button type="submit">Finalize review</button>
                      </form>
                    ) : "Finalized"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
