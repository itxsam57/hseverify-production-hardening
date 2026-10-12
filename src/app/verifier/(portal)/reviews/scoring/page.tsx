import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { WrittenScoringService } from "@/lib/scoring/written-scoring-service";
import { getDatabaseClient } from "@/lib/database/database";
import {
  getScoringAiProviderStatus,
  WrittenScoringAssistanceService
} from "@/lib/scoring/written-scoring-assistance-service";
import {
  addWrittenScoreRubricMarkAction,
  finalizeWrittenScoreAction,
  generateWrittenScoringAssistanceAction,
  reviewWrittenScoringAssistanceAction,
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
  const [assistance, aiProvider] = await Promise.all([
    new WrittenScoringAssistanceService().listForReviewer(actor.accountId),
    Promise.resolve(getScoringAiProviderStatus())
  ]);
  const typedReviews = reviews;

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
                const reviewAssistance = assistance.filter((item) => item.reviewId === review.review_id);
                const latestAssistance = reviewAssistance[0] ?? null;
                return (
                  <tr key={review.review_id}>
                    <td>
                      {review.case_id}
                      <br />
                      <strong>{review.status}</strong>
                      <section className="content-stack" aria-label={"Assessment evidence " + review.review_id}>
                        {review.questions.map(question => (
                          <article key={question.position} className="content-stack">
                            <h2>Question {question.position}</h2>
                            <p>{question.prompt}</p>
                            <strong>{question.answered ? "Retained response" : "Unanswered"}</strong>
                            <p style={{whiteSpace:"pre-wrap"}}>{question.answered ? question.response ?? "No response value recorded." : "No answer was submitted for this question."}</p>
                            {question.expectedAnswer !== null ? <p>Pinned answer key: {String(question.expectedAnswer)}</p> : null}
                            {question.rubricCriteria.length > 0 ? (
                              <ul>{question.rubricCriteria.map((criterion,index) => <li key={index}>{criterion.description} ({criterion.points} points)</li>)}</ul>
                            ) : null}
                          </article>
                        ))}
                      </section>
                    </td>
                    <td>
                      <section className="content-stack" aria-label={"AI scoring guidance " + review.review_id}>
                        <strong>AI guidance</strong>
                        <p className="muted-copy">{aiProvider.reason}</p>
                        {review.status === "DRAFT" && aiProvider.available ? (
                          <form action={generateWrittenScoringAssistanceAction}>
                            <input type="hidden" name="reviewId" value={review.review_id} />
                            <button type="submit">Generate sandbox AI suggestion</button>
                          </form>
                        ) : null}
                        {latestAssistance ? (
                          <div className="content-stack">
                            <p>
                              {latestAssistance.providerKey.toUpperCase()} · {latestAssistance.status.replaceAll("_", " ")}
                            </p>
                            <p>
                              Suggested overall: {latestAssistance.suggestion.overallScoreSuggestion}% — guidance only
                            </p>
                            {latestAssistance.suggestion.criteria.length > 0 ? (
                              <ul>
                                {latestAssistance.suggestion.criteria.slice(0, 8).map((criterion, index) => (
                                  <li key={criterion.questionPosition + ":" + criterion.criterion + ":" + index}>
                                    Q{criterion.questionPosition}: {criterion.criterion} — {criterion.suggestedPercent}%
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {latestAssistance.status === "GENERATED" ? (
                              <form action={reviewWrittenScoringAssistanceAction} className="content-stack">
                                <input type="hidden" name="assistanceId" value={latestAssistance.assistanceId} />
                                <label>
                                  Guidance decision
                                  <select name="guidanceDecision" defaultValue="ACCEPTED_AS_GUIDANCE">
                                    <option value="ACCEPTED_AS_GUIDANCE">Accept as guidance</option>
                                    <option value="REJECTED">Reject guidance</option>
                                  </select>
                                </label>
                                <label>
                                  Guidance review reason
                                  <input name="guidanceReason" minLength={5} maxLength={2000} required />
                                </label>
                                <button type="submit">Record AI guidance review</button>
                              </form>
                            ) : null}
                            <p className="muted-copy">AI guidance never writes or finalizes the human score.</p>
                          </div>
                        ) : null}
                      </section>
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
                          <label><input type="checkbox" name="assessorVisible" />Share this reason with the assigned Assessor</label>
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
