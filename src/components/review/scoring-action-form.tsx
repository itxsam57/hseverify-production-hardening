"use client";

import { useSyncExternalStore } from "react";
const subscribe = (): (() => void) => () => {};
const clientReady = (): boolean => true;
const serverReady = (): boolean => false;
function useReady(): boolean { return useSyncExternalStore(subscribe, clientReady, serverReady); }
type Action = (form: FormData) => void | Promise<void>;

export function RubricMarkForm({ action, reviewId, revision, criterion, description, points, mark, reason }: {
  action: Action; reviewId: string; revision: number; criterion: string; description: string; points: number; mark: number | null; reason: string;
}): React.JSX.Element {
  const ready = useReady();
  return <form action={action} className="content-stack" aria-label={`Rubric mark ${criterion}`} inert={!ready} aria-busy={!ready}>
    <input type="hidden" name="reviewId" value={reviewId} />
    <input type="hidden" name="criterion" value={criterion} />
    <input type="hidden" name="expectedRevision" value={revision} />
    <strong>{criterion} · {description} ({points} points)</strong>
    <label>Criterion mark<input disabled={!ready} name="mark" type="number" min="0" max="100" required defaultValue={mark ?? ""} /></label>
    <label>Mark reason<textarea disabled={!ready} name="markReason" minLength={5} maxLength={4000} required defaultValue={reason} /></label>
    <button type="submit" disabled={!ready}>Save mark</button>
  </form>;
}

export function ScoringDecisionForm({ action, reviewId, revision, score, allCriteriaMarked, decision, reason }: {
  action: Action; reviewId: string; revision: number; score: number | null; allCriteriaMarked: boolean; decision: string | null; reason: string;
}): React.JSX.Element {
  const ready = useReady();
  return <form action={action} className="content-stack" inert={!ready} aria-busy={!ready}>
    <input type="hidden" name="reviewId" value={reviewId} />
    <input type="hidden" name="expectedRevision" value={revision} />
    <p><strong>Overall score:</strong> {score ?? (allCriteriaMarked ? "Ready to calculate from rubric marks" : "Save every rubric criterion first")}</p>
    <label>Decision<select disabled={!ready} name="decision" required defaultValue={decision ?? ""}>
      <option value="" disabled>Select decision</option><option value="PASS">PASS</option><option value="FAIL">FAIL</option>
      <option value="CHANGES_REQUESTED">CHANGES REQUESTED</option><option value="ADDITIONAL_REVIEW">ADDITIONAL REVIEW — independent second Verifier</option>
    </select></label>
    <label>Reason<textarea disabled={!ready} name="reason" required minLength={5} maxLength={4000} defaultValue={reason} /></label>
    <button type="submit" disabled={!ready || !allCriteriaMarked}>Save scoring decision</button>
  </form>;
}
