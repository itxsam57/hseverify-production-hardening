"use client";

import { useActionState } from "react";

import {
  createRootBootstrapInvitation,
  type StaffInvitationActionState
} from "@/app/staff/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";

const INITIAL_STATE: StaffInvitationActionState = {
  error: null,
  invitationPath: null,
  invitedEmail: null,
  invitedRole: null
};

export function RootBootstrapForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(
    createRootBootstrapInvitation,
    INITIAL_STATE
  );
  return (
    <div>
      <Alert tone="warning">
        Development/test bootstrap only. It works once, before the first root account exists.
      </Alert>
      <form action={action} className="auth-form" noValidate>
        <Field htmlFor="bootstrap-root-email" label="First root email">
          <Input
            autoComplete="off"
            id="bootstrap-root-email"
            inputMode="email"
            maxLength={254}
            name="email"
            required
            type="email"
          />
        </Field>
        <Field htmlFor="bootstrap-root-key" label="Authentication sandbox access key">
          <Input
            autoComplete="off"
            id="bootstrap-root-key"
            maxLength={256}
            name="accessKey"
            required
            type="password"
          />
        </Field>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        <Button disabled={pending} fullWidth type="submit">
          {pending ? "Creating protected invitation…" : "Create first root invitation"}
        </Button>
      </form>
      {state.invitationPath ? (
        <section className="security-key-card" role="status">
          <span>One-time root invitation</span>
          <strong>{state.invitationPath}</strong>
          <p>Copy this path now. It cannot be recreated after a root account exists.</p>
        </section>
      ) : null}
    </div>
  );
}
