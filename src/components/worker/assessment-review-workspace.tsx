"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  reviseAssessmentAnswerAction,
  setAssessmentReviewFlagAction,
  type AssessmentReviewActionState
} from "@/app/worker/(portal)/assessments/[attemptId]/actions";
import { AnswerControl } from "@/components/worker/assessment-workspace";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import type { AssessmentReviewQuestionView } from "@/lib/assessment-attempt/assessment-attempt-domain";

const INITIAL: AssessmentReviewActionState = Object.freeze({
  status: "idle",
  message: ""
});

function stringValue(value: AssessmentReviewQuestionView["value"]): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function encodeAnswer(questionType: string, value: string): string {
  if (questionType === "TRUE_FALSE") {
    if (value === "true") return "true";
    if (value === "false") return "false";
    return JSON.stringify(value);
  }
  if (questionType === "INTEGER" || questionType === "DECIMAL") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (trimmed && Number.isFinite(numeric)) return JSON.stringify(numeric);
  }
  return JSON.stringify(value);
}

export function AssessmentReviewWorkspace({
  review,
  routeError
}: {
  review: AssessmentReviewQuestionView;
  routeError?: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const [value, setValue] = useState(() => stringValue(review.value));
  const [state, action, pending] = useActionState(reviseAssessmentAnswerAction, INITIAL);

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <section className="page-stack" aria-labelledby="assessment-review-question-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {review.progressionMode === "SECTION_REVIEW" ? "Section Review" : "Controlled Review"}
          </p>
          <h1 id="assessment-review-question-heading">Review question {review.position}</h1>
          <p>
            {review.sectionTitle ? `${review.sectionTitle} · ` : ""}
            Question {review.position} of {review.questionCount}
          </p>
        </div>
        <Link className="ds-button ds-button-secondary" href={`/worker/assessments/${review.attemptId}`}>
          Return to assessment
        </Link>
      </div>

      {routeError ? <Alert tone="danger" role="alert">{routeError}</Alert> : null}
      {state.message ? (
        <Alert tone={state.status === "success" ? "success" : "danger"} role="status">
          {state.message}
        </Alert>
      ) : null}

      <section className="panel page-section content-stack">
        <div>
          <p className="eyebrow">{review.domainReference} · {review.difficulty}</p>
          <h2>Question {review.position}</h2>
          <p>{review.prompt}</p>
        </div>

        <p className="muted-copy">
          Revisions are append-only. Revision {review.revisionCount} is currently effective;
          the original committed answer remains preserved.
        </p>

        <form action={action} className="content-stack">
          <input type="hidden" name="attemptId" value={review.attemptId} />
          <input type="hidden" name="position" value={String(review.position)} />
          <input type="hidden" name="answer" value={encodeAnswer(review.questionType, value)} />
          <AnswerControl
            questionType={review.questionType}
            options={review.options}
            value={value}
            onChange={setValue}
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving revision…" : "Save revised answer"}
          </Button>
        </form>

        <form action={setAssessmentReviewFlagAction}>
          <input type="hidden" name="attemptId" value={review.attemptId} />
          <input type="hidden" name="position" value={String(review.position)} />
          <input type="hidden" name="flagged" value={review.flagged ? "no" : "yes"} />
          <Button type="submit" variant="secondary">
            {review.flagged ? "Remove review flag" : "Flag for review"}
          </Button>
        </form>
      </section>
    </section>
  );
}
