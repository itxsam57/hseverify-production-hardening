type CompanyOrganizationActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string | null;
}>;

type CompanyTeamActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string | null;
  invitationPath: string | null;
}>;

type CompanyVerificationActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string | null;
  fieldErrors: Readonly<Record<string, string>>;
}>;

type PublicVerificationActionState = Readonly<{
  status: "idle" | "error" | "unavailable";
  message: string | null;
}>;

export const INITIAL_COMPANY_ORGANIZATION_ACTION_STATE: CompanyOrganizationActionState =
  Object.freeze({ status: "idle", message: null });

export const INITIAL_COMPANY_TEAM_ACTION_STATE: CompanyTeamActionState =
  Object.freeze({ status: "idle", message: null, invitationPath: null });

export const INITIAL_COMPANY_VERIFICATION_ACTION_STATE: CompanyVerificationActionState =
  Object.freeze({
    status: "idle",
    message: null,
    fieldErrors: Object.freeze({})
  });

export const INITIAL_PUBLIC_VERIFICATION_ACTION_STATE: PublicVerificationActionState =
  Object.freeze({ status: "idle", message: null });
