"use client";

import { useActionState } from "react";

import type { StaffInvitationActionState } from "@/app/staff/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import type { StaffRole } from "@/lib/auth/staff-provisioning-service";

const INITIAL_STATE: StaffInvitationActionState = {
  error: null,
  invitationPath: null,
  invitedEmail: null,
  invitedRole: null
};

type InvitationAction = (
  previousState: StaffInvitationActionState,
  formData: FormData
) => Promise<StaffInvitationActionState>;

export function StaffInvitationForm({
  action,
  allowedRoles
}: {
  action: InvitationAction;
  allowedRoles: StaffRole[];
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  return (
    <div>
      <form action={formAction} className="auth-form" noValidate>
        <Field htmlFor="staff-invitation-email" label="Staff email">
          <Input
            autoComplete="off"
            id="staff-invitation-email"
            inputMode="email"
            maxLength={254}
            name="email"
            required
            type="email"
          />
        </Field>
        <Field htmlFor="staff-invitation-role" label="Portal role">
          <Select id="staff-invitation-role" name="role" required>
            {allowedRoles.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </Select>
        </Field>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        <Button disabled={pending} fullWidth type="submit">
          {pending ? "Creating invitation…" : "Create one-time invitation"}
        </Button>
      </form>

      {state.invitationPath ? (
        <section className="security-key-card" role="status">
          <span>
            One-time invitation for {state.invitedEmail} · {state.invitedRole}
          </span>
          <strong>{state.invitationPath}</strong>
          <p>
            Copy this path now. The plaintext invitation token is not stored and will not be shown again after leaving this result.
          </p>
        </section>
      ) : null}
    </div>
  );
}
