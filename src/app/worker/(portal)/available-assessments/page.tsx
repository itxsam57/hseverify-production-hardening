import Link from "next/link";

import { beginAssessmentAction } from "@/app/worker/(portal)/available-assessments/actions";
import { Button } from "@/components/ui/button";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getAssessmentCatalogueEligibilityService } from "@/lib/assessment-catalogue/assessment-catalogue-eligibility-service";
import { getAssessmentAttemptService } from "@/lib/assessment-attempt/assessment-attempt-service";

export const dynamic = "force-dynamic";

export default async function AvailableAssessmentsPage(): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });
  const [available, inProgress] = await Promise.all([
    (await getAssessmentCatalogueEligibilityService()).listAvailableForWorker(principal),
    (await getAssessmentAttemptService()).listOwnedInProgress(principal)
  ]);

  return (
    <section className="page-stack" aria-labelledby="available-assessments-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Assessment eligibility</p>
          <h1 id="available-assessments-heading">Available assessments</h1>
          <p>
            This list is calculated from your own Assessment pending assurance cases, their locked
            framework policy and your approved current qualification evidence. Viewing this page is
            read-only; an assessment attempt is created only when you choose Start assessment.
          </p>
        </div>
      </div>

      <section className="content-stack" aria-labelledby="in-progress-assessments-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Continue assessment</p>
            <h2 id="in-progress-assessments-heading">In progress</h2>
          </div>
        </div>
        {inProgress.length === 0 ? (
          <section className="panel page-section" aria-label="No assessments in progress">
            <p className="muted-copy">You do not currently have an assessment in progress.</p>
          </section>
        ) : (
          inProgress.map((attempt) => (
            <article className="panel page-section" key={attempt.attemptId}>
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">Assessment</p>
                  <h3>{attempt.catalogueTitle}</h3>
                </div>
                <span className="status-pill">In progress</span>
              </div>
              <dl>
                <div>
                  <dt>Progress</dt>
                  <dd>
                    Question {attempt.currentPosition} of {attempt.questionCount}
                  </dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{attempt.startedAt}</dd>
                </div>
              </dl>
              <Link
                href={`/worker/assessments/${attempt.attemptId}`}
                className="ds-button ds-button-secondary"
              >
                Resume assessment
              </Link>
            </article>
          ))
        )}
      </section>

      {available.length === 0 ? (
        <section className="panel page-section" aria-label="No available assessments">
          <h2>No assessments are currently available.</h2>
          <p className="muted-copy">
            An assessment appears here only when an owned assurance case is ready and every
            configured eligibility requirement is satisfied. No action is required on this page
            while the list is empty.
          </p>
        </section>
      ) : (
        <section className="content-stack" aria-label="Eligible assessment offerings">
          {available.map((assessment) => (
            <article className="panel page-section" key={`${assessment.caseId}-${assessment.catalogueVersionId}`}>
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">{assessment.catalogueReference}</p>
                  <h2>{assessment.title}</h2>
                </div>
                <span className="status-pill">Eligible</span>
              </div>
              {assessment.description ? <p>{assessment.description}</p> : null}
              <dl>
                <div>
                  <dt>Assurance case</dt>
                  <dd><code>{assessment.caseId}</code></dd>
                </div>
                <div>
                  <dt>Verified qualifications</dt>
                  <dd>
                    {assessment.verifiedQualificationCount} / {assessment.minimumVerifiedQualifications} required
                  </dd>
                </div>
                <div>
                  <dt>Framework</dt>
                  <dd><code>{assessment.frameworkId}</code></dd>
                </div>
              </dl>
              <form action={beginAssessmentAction} className="content-stack">
                <input type="hidden" name="caseId" value={assessment.caseId} />
                <input
                  type="hidden"
                  name="catalogueVersionId"
                  value={assessment.catalogueVersionId}
                />
                <p className="muted-copy">
                  Starting creates or reuses your protected attempt and opens only the first current
                  question. Later questions are not delivered until the current answer is saved.
                </p>
                <Button type="submit">Start assessment</Button>
              </form>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
