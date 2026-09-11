"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  completePasswordRecovery,
  requestPasswordRecovery,
  resendPasswordRecoveryCode,
  type RecoveryActionState
} from "@/app/auth/recover/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import type { AuthRole } from "@/lib/auth/auth-domain";

const INITIAL_STATE: RecoveryActionState = {
  error: null,
  message: null,
  retryAt: null
};

export function RecoveryRequestForm({
  role
}: {
  role: AuthRole;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    requestPasswordRecovery,
    INITIAL_STATE
  );
  return (
    <form action={action} className="auth-form" noValidate>
      <input name="role" type="hidden" value={role} />
      <Field htmlFor="recovery-email" label="Account email">
        <Input
          autoComplete="username"
          id="recovery-email"
          inputMode="email"
          maxLength={254}
          name="email"
          required
          type="email"
        />
      </Field>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button disabled={pending} fullWidth type="submit">
        {pending ? "Starting recovery…" : "Continue securely"}
      </Button>
    </form>
  );
}

export function RecoveryCompletionForm({
  role
}: {
  role: AuthRole;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    completePasswordRecovery,
    INITIAL_STATE
  );
  const [resendState, resendAction, resendPending] = useActionState(
    resendPasswordRecoveryCode,
    INITIAL_STATE
  );

  return (
    <>
      <form action={action} className="auth-form" noValidate>
        <Field
          hint="Use the latest six-digit code. Earlier or consumed codes cannot be reused."
          htmlFor="recovery-code"
          label="Recovery code"
        >
          <Input
            autoComplete="one-time-code"
            id="recovery-code"
            inputMode="numeric"
            maxLength={6}
            name="code"
            pattern="[0-9]{6}"
            required
          />
        </Field>
        <Field htmlFor="recovery-password" label="New password">
          <Input
            autoComplete="new-password"
            id="recovery-password"
            maxLength={128}
            name="password"
            required
            type="password"
          />
        </Field>
        <Field htmlFor="recovery-confirm-password" label="Confirm new password">
          <Input
            autoComplete="new-password"
            id="recovery-confirm-password"
            maxLength={128}
            name="confirmPassword"
            required
            type="password"
          />
        </Field>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        <Button disabled={pending} fullWidth type="submit">
          {pending ? "Resetting password…" : "Reset password and revoke sessions"}
        </Button>
      </form>

      <form action={resendAction} className="auth-form">
        {resendState.error ? <Alert tone="danger">{resendState.error}</Alert> : null}
        {resendState.message ? <Alert tone="success">{resendState.message}</Alert> : null}
        <Button disabled={resendPending} fullWidth type="submit" variant="secondary">
          {resendPending ? "Issuing new code…" : "Send a new recovery code"}
        </Button>
      </form>

      <p className="muted-copy">
        <Link href={`/${role}/login`}>Return to portal sign in</Link>
      </p>
    </>
  );
}
