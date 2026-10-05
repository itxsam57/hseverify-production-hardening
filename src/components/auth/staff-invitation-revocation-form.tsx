"use client";

import { useActionState } from "react";
import { revokeStaffInvitation } from "@/app/staff/actions";

export function StaffInvitationRevocationForm({invitationId, portal}: {
  invitationId: string; portal: "admin" | "root";
}): React.JSX.Element {
  const [state, action, pending] = useActionState(revokeStaffInvitation, {error: null});
  return (
    <form action={action}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <input type="hidden" name="portal" value={portal} />
      <button type="submit" disabled={pending}>{pending ? "Revoking…" : "Revoke invitation"}</button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
