export type WorkerEvidenceActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string;
  fieldErrors: Readonly<Record<string, string>>;
}>;

export const INITIAL_WORKER_EVIDENCE_ACTION_STATE: WorkerEvidenceActionState =
  Object.freeze({
    status: "idle",
    message: "",
    fieldErrors: Object.freeze({})
  });
