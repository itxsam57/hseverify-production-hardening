export type WorkerIdentityActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string;
  fieldErrors: Readonly<Record<string, string>>;
}>;

export const INITIAL_WORKER_IDENTITY_ACTION_STATE: WorkerIdentityActionState =
  Object.freeze({
    status: "idle",
    message: "",
    fieldErrors: Object.freeze({})
  });
