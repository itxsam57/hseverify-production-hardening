export type WorkerIdentityDraftSaveState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string;
  fieldErrors: Readonly<Record<string, string>>;
  draftRevision: number | null;
}>;

export const INITIAL_WORKER_IDENTITY_DRAFT_SAVE_STATE: WorkerIdentityDraftSaveState =
  Object.freeze({
    status: "idle",
    message: "",
    fieldErrors: Object.freeze({}),
    draftRevision: null
  });
