"use client";

import { useActionState } from "react";

import {
  completeStaffEnrollmentProfile,
  verifyStaffEnrollmentTotp,
  type StaffEnrollmentActionState
} from "@/app/staff/invite/accept/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";

const INITIAL_STATE: StaffEnrollmentActionState = { error: null };

export function StaffProfileEnrollmentForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(
    completeStaffEnrollmentProfile,
    INITIAL_STATE
  );
  return (
    <form action={action} className="auth-form" noValidate>
      <Field htmlFor="staff-display-name" label="Full name">
        <Input
          autoComplete="name"
          id="staff-display-name"
          maxLength={120}
          name="displayName"
          required
        />
      </Field>
      <Field htmlFor="staff-password" label="Create password">
        <Input
          autoComplete="new-password"
          id="staff-password"
          maxLength={128}
          name="password"
          required
          type="password"
        />
      </Field>
      <Field htmlFor="staff-confirm-password" label="Confirm password">
        <Input
          autoComplete="new-password"
          id="staff-confirm-password"
          maxLength={128}
          name="confirmPassword"
          required
          type="password"
        />
      </Field>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button disabled={pending} fullWidth type="submit">
        {pending ? "Creating protected account…" : "Continue to authenticator setup"}
      </Button>
    </form>
  );
}

export function StaffTotpEnrollmentForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(
    verifyStaffEnrollmentTotp,
    INITIAL_STATE
  );
  return (
    <form action={action} className="auth-form" noValidate>
      <Field
        hint="Enter a fresh six-digit code from the authenticator app after adding the setup key."
        htmlFor="staff-totp-code"
        label="Authenticator code"
      >
        <Input
          autoComplete="one-time-code"
          id="staff-totp-code"
          inputMode="numeric"
          maxLength={6}
          name="code"
          pattern="[0-9]{6}"
          required
        />
      </Field>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button disabled={pending} fullWidth type="submit">
        {pending ? "Verifying authenticator…" : "Activate MFA and finish enrollment"}
      </Button>
    </form>
  );
}
