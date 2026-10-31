"use client";

import { useActionState, useState } from "react";

type ImportState = { status: "idle" | "error" | "success"; message: string };
const INITIAL: ImportState = { status: "idle", message: "" };
const EXAMPLE = JSON.stringify([{
  questionReference: "HSE-IMPORT-001",
  version: {
    questionType: "MULTIPLE_CHOICE",
    prompt: "What action must be taken before entering an uncontrolled hazard area?",
    options: ["Stop and assess", "Proceed without checking"],
    answerKey: "Stop and assess",
    rubric: null,
    frameworkReference: "HSE-CORE",
    domainReference: "Hazard control",
    difficulty: "MEDIUM",
    tags: ["hazards", "core"]
  }
}], null, 2);

export function QuestionBulkImportForm({ action }: {
  action: (state: ImportState, formData: FormData) => Promise<ImportState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);
  const [batch, setBatch] = useState("");
  return <form action={submit}>
    <h2>Bulk import draft questions</h2>
    <p>Paste a JSON array of 1–25 questions. Every row needs a stable questionReference and version object. Invalid rows reject the entire batch. Imports remain drafts and still require independent review.</p>
    <label>Question batch JSON
      <textarea name="questionBatch" rows={10} required maxLength={60000} value={batch} onChange={event => setBatch(event.target.value)} placeholder={EXAMPLE}/>
    </label>
    <button type="submit" disabled={pending || !batch.trim()}>{pending ? "Validating batch…" : "Validate and import drafts"}</button>
    {state.message ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
  </form>;
}
