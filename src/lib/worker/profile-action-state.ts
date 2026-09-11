import type { ProfileSection } from "@/lib/worker/profile-domain";

export type ProfileActionState = {
  status: "idle" | "success" | "error" | "conflict";
  message: string;
  fieldErrors: Record<string, string>;
  nextSection: ProfileSection | null;
};

export const INITIAL_PROFILE_ACTION_STATE: ProfileActionState = {
  status: "idle",
  message: "",
  fieldErrors: {},
  nextSection: null
};
