export type PublicConcernActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string | null;
  concernReference: string | null;
}>;

export const INITIAL_PUBLIC_CONCERN_ACTION_STATE: PublicConcernActionState =
  Object.freeze({
    status: "idle",
    message: null,
    concernReference: null
  });
