"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import {
  advanceAssessmentSectionAction,
  finalizeAssessmentAction,
  interruptAssessmentAction,
  submitAssessmentAnswerAction,
  type AssessmentAnswerActionState,
  type AssessmentProgressionActionState
} from "@/app/worker/(portal)/assessments/[attemptId]/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { AssessmentAttemptClientView } from "@/lib/assessment-attempt/assessment-attempt-domain";
import { useAssessmentDraftAutosave } from "./use-assessment-draft-autosave";

const INITIAL_STATE: AssessmentAnswerActionState = Object.freeze({
  status: "idle",
  message: ""
});
const PROGRESSION_INITIAL: AssessmentProgressionActionState = Object.freeze({
  status: "idle",
  message: ""
});

function encodeAnswer(questionType: string, value: string): string {
  if (questionType === "TRUE_FALSE") {
    if (value === "true") return "true";
    if (value === "false") return "false";
    return JSON.stringify(value);
  }
  if (questionType === "INTEGER" || questionType === "DECIMAL") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return JSON.stringify(numeric);
    }
  }
  return JSON.stringify(value);
}

export function AnswerControl({
  questionType,
  options,
  value,
  onChange
}: {
  questionType: NonNullable<AssessmentAttemptClientView["currentQuestion"]>["questionType"];
  options: readonly string[] | null;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  if (questionType === "MULTIPLE_CHOICE") {
    return (
      <fieldset className="content-stack">
        <legend>Choose one answer</legend>
        {(options ?? []).map((option) => (
          <label className="ds-checkbox-field" key={option}>
            <input
              type="radio"
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (questionType === "TRUE_FALSE") {
    return (
      <fieldset className="content-stack">
        <legend>Choose true or false</legend>
        {[
          ["true", "True"],
          ["false", "False"]
        ].map(([optionValue, label]) => (
          <label className="ds-checkbox-field" key={optionValue}>
            <input
              type="radio"
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (questionType === "SHORT_TEXT") {
    return (
      <Field htmlFor="assessment-short-answer" label="Your answer">
        <Input
          id="assessment-short-answer"
          type="text"
          value={value}
          maxLength={2000}
          onChange={(event) => onChange(event.currentTarget.value)}
          autoComplete="off"
        />
      </Field>
    );
  }

  if (questionType === "LONG_TEXT") {
    return (
      <Field htmlFor="assessment-long-answer" label="Your answer">
        <Textarea
          id="assessment-long-answer"
          value={value}
          maxLength={20000}
          rows={10}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </Field>
    );
  }

  if (questionType === "INTEGER") {
    return (
      <Field htmlFor="assessment-integer-answer" label="Your answer">
        <Input
          id="assessment-integer-answer"
          type="text"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          inputMode="numeric"
          autoComplete="off"
        />
      </Field>
    );
  }

  if (questionType === "DECIMAL") {
    return (
      <Field htmlFor="assessment-decimal-answer" label="Your answer">
        <Input
          id="assessment-decimal-answer"
          type="text"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          inputMode="decimal"
          autoComplete="off"
        />
      </Field>
    );
  }

  return <Alert tone="danger">This question type is unavailable.</Alert>;
}


function ReviewLinks({
  view
}: {
  view: AssessmentAttemptClientView;
}): React.JSX.Element | null {
  if (view.progressionMode === "STRICT" || view.reviewablePositions.length === 0) {
    return null;
  }
  return (
    <section className="content-stack" aria-labelledby="review-answers-heading">
      <div>
        <p className="eyebrow">
          {view.progressionMode === "SECTION_REVIEW" ? "Current section review" : "Controlled review"}
        </p>
        <h3 id="review-answers-heading">Review committed answers</h3>
        {view.sectionTitle ? <p>{view.sectionTitle}</p> : null}
      </div>
      <div className="button-row">
        {view.reviewablePositions.map((position) => (
          <Link
            className="ds-button ds-button-secondary"
            href={`/worker/assessments/${view.attemptId}/review/${position}`}
            key={position}
          >
            Question {position}{view.flaggedPositions.includes(position) ? " ⚑" : ""}
          </Link>
        ))}
      </div>
    </section>
  );
}

function ProgressionReviewGate({
  view
}: {
  view: AssessmentAttemptClientView;
}): React.JSX.Element {
  const gateAttemptId = view.attemptId;
  const action = view.awaitingSectionAdvance
    ? advanceAssessmentSectionAction
    : finalizeAssessmentAction;
  const [state, formAction, pending] = useActionState(action, PROGRESSION_INITIAL);
  return (
    <section className="page-stack" aria-labelledby="assessment-review-gate-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {view.awaitingSectionAdvance ? "Section review" : "Final review"}
          </p>
          <h1 id="assessment-review-gate-heading">
            {view.awaitingSectionAdvance
              ? `Review ${view.sectionTitle ?? "this section"} before locking it`
              : "Review answers before final submission"}
          </h1>
          <p>
            {view.awaitingSectionAdvance
              ? "You may revise answers in the current section. Once you continue, this section is permanently locked."
              : "You may revise every answer still allowed by this progression mode. Final submission permanently closes candidate editing."}
          </p>
        </div>
      </div>
      <section className="panel page-section content-stack">
        <ReviewLinks view={view} />
        {state.message ? <Alert tone="danger" role="alert">{state.message}</Alert> : null}
        <form action={formAction}>
          <input type="hidden" name="attemptId" value={gateAttemptId} />
          <Button type="submit" disabled={pending || !gateAttemptId}>
            {pending
              ? "Saving…"
              : view.awaitingSectionAdvance
                ? "Lock section and continue"
                : "Submit assessment"}
          </Button>
        </form>
      </section>
    </section>
  );
}

function ActiveAssessmentWorkspace({
  view,
  question
}: {
  view: AssessmentAttemptClientView;
  question: NonNullable<AssessmentAttemptClientView["currentQuestion"]>;
}): React.JSX.Element {
  const router = useRouter();
  const [exitPending, setExitPending] = useState(false);
  const [exitError, setExitError] = useState("");
  const [technicalIssue, setTechnicalIssue] = useState("");
  const [state, action, pending] = useActionState(
    submitAssessmentAnswerAction,
    INITIAL_STATE
  );
  const {
    value: answer,
    recoveryReady,
    setValue: setAnswer,
    saveStatus,
    conflict,
    useSavedVersion,
    replaceSavedVersion,
    flushExactCurrentEdit,
    bestEffortCurrentEdit
  } = useAssessmentDraftAutosave({
    question,
    initialDraft: view.currentDraft
  });

  const handleSaveAndExit = async (): Promise<void> => {
    setExitPending(true);
    const saved = await flushExactCurrentEdit();
    if (saved) {
      router.push("/worker/available-assessments");
      return;
    }
    setExitPending(false);
  };

  const handleEmergencyExit = async (): Promise<void> => {
    setExitPending(true);
    setExitError("");
    await bestEffortCurrentEdit();
    const result = await interruptAssessmentAction(question.attemptId, "emergency_exit");
    if (result.ok) {
      router.push("/worker/available-assessments");
      return;
    }
    setExitError(result.message);
    setExitPending(false);
  };

  const handleTechnicalIssue = async (): Promise<void> => {
    const detail = technicalIssue.trim();
    if (detail.length < 5) {
      setExitError("Describe the technical issue before recording it.");
      return;
    }
    setExitPending(true);
    setExitError("");
    await bestEffortCurrentEdit();
    const result = await interruptAssessmentAction(
      question.attemptId,
      "technical_issue",
      detail
    );
    if (result.ok) {
      router.push("/worker/available-assessments");
      return;
    }
    setExitError(result.message);
    setExitPending(false);
  };

  return (
    <section className="page-stack" aria-labelledby="assessment-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Candidate assessment</p>
          <h1 id="assessment-heading">Assessment</h1>
          <p>Question {question.position} of {question.questionCount}</p>
        </div>
      </div>

      <section className="panel page-section content-stack" aria-labelledby="current-question-heading">
        <div>
          <p className="eyebrow">{question.domainReference} · {question.difficulty}</p>
          <h2 id="current-question-heading">Question {question.position}</h2>
          <p>{question.prompt}</p>
        </div>

        <div role="status" aria-live="polite">
          {saveStatus}
        </div>

        {conflict ? (
          <Alert tone="warning">
            <div className="content-stack">
              <p>{conflict.message}</p>
              {conflict.serverDraft ? (
                <div className="button-row">
                  <Button type="button" variant="secondary" onClick={useSavedVersion}>
                    Use saved version
                  </Button>
                  <Button type="button" onClick={replaceSavedVersion}>
                    Replace saved version with this tab
                  </Button>
                </div>
              ) : (
                <p>Reload the current question before editing again.</p>
              )}
            </div>
          </Alert>
        ) : null}

        {state.message ? (
          <Alert tone={state.status === "conflict" ? "warning" : "danger"} role="status">
            {state.message}
          </Alert>
        ) : null}

        <p className="muted-copy">
          Progression: {view.progressionMode.replaceAll("_", " ")}
          {view.sectionTitle ? ` · ${view.sectionTitle}` : ""}
        </p>
        <ReviewLinks view={view} />

        <form action={action} className="content-stack">
          <input type="hidden" name="attemptId" value={question.attemptId} />
          <input type="hidden" name="position" value={String(question.position)} />
          <input type="hidden" name="questionVersionId" value={question.questionVersionId} />
          <input type="hidden" name="answer" value={encodeAnswer(question.questionType, answer)} />

          <AnswerControl
            questionType={question.questionType}
            options={question.options}
            value={answer}
            onChange={setAnswer}
          />

          <Button type="submit" disabled={pending || exitPending || !recoveryReady || conflict !== null}>
            {pending
              ? "Saving…"
              : question.position === question.questionCount
                ? view.progressionMode === "STRICT"
                  ? "Submit assessment"
                  : "Save final answer for review"
                : view.progressionMode === "SECTION_REVIEW" &&
                    view.sectionTitle &&
                    view.reviewablePositions.length + 1 === question.position
                  ? "Save answer"
                  : "Next"}
          </Button>
        </form>

        <div className="content-stack" aria-label="Assessment exit controls">
          <div className="button-row">
            <Button
              type="button"
              variant="secondary"
              disabled={exitPending || !recoveryReady}
              onClick={() => void handleSaveAndExit()}
            >
              {exitPending ? "Saving before exit…" : "Save and exit"}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void handleEmergencyExit()}
            >
              Emergency exit
            </Button>
          </div>
          <p className="muted-copy">
            Emergency exit does not submit or advance this assessment. It records an INTERRUPTED state and only the last server-confirmed Saved version is guaranteed recoverable.
          </p>
          <details>
            <summary>Report technical issue</summary>
            <div className="content-stack">
              <Field htmlFor="assessment-technical-issue" label="What happened?">
                <Textarea
                  id="assessment-technical-issue"
                  rows={4}
                  value={technicalIssue}
                  maxLength={1000}
                  onChange={(event) => setTechnicalIssue(event.currentTarget.value)}
                />
              </Field>
              <Button
                type="button"
                variant="secondary"
                disabled={exitPending}
                onClick={() => void handleTechnicalIssue()}
              >
                Record issue and interrupt safely
              </Button>
            </div>
          </details>
          {exitError ? <Alert tone="danger" role="alert">{exitError}</Alert> : null}
        </div>
      </section>
    </section>
  );
}

export function AssessmentWorkspace({
  view
}: {
  view: AssessmentAttemptClientView;
}): React.JSX.Element {
  if (view.awaitingSectionAdvance || view.awaitingFinalSubmit) {
    return <ProgressionReviewGate view={view} />;
  }

  if (view.submitted) {
    return (
      <section className="page-stack" aria-labelledby="assessment-heading">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Assessment submitted</p>
            <h1 id="assessment-heading">Assessment</h1>
            <p>Your responses have been submitted. Objective scoring and any required human review now continue through the Assurance Case workflow.</p>
          </div>
        </div>
        <Alert tone="success" role="status">
          Submission received. You may leave this page safely.
        </Alert>
      </section>
    );
  }

  const question = view.currentQuestion;
  if (!question) {
    return (
      <section className="page-stack" aria-labelledby="assessment-heading">
        <h1 id="assessment-heading">Assessment</h1>
        <Alert tone="danger">The current question is unavailable.</Alert>
      </section>
    );
  }

  return (
    <ActiveAssessmentWorkspace
      key={`${question.attemptId}:${question.position}:${question.questionVersionId}`}
      view={view}
      question={question}
    />
  );
}