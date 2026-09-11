"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { RoleLoginActionState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import type { AuthRole } from "@/lib/auth/auth-domain";

const INITIAL_STATE: RoleLoginActionState = { error: null };

type RoleLoginAction = (
  previousState: RoleLoginActionState,
  formData: FormData
) => Promise<RoleLoginActionState>;

export function RoleLoginForm({
  action,
  role,
  requiresMfa,
  returnTo
}: {
  action: RoleLoginAction;
  role: AuthRole;
  requiresMfa: boolean;
  returnTo?: string;
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="auth-form" noValidate>
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <Field htmlFor={`${role}-email`} label="Email address">
        <Input
          autoComplete="username"
          id={`${role}-email`}
          inputMode="email"
          maxLength={254}
          name="email"
          required
          type="email"
        />
      </Field>

      <Field htmlFor={`${role}-password`} label="Password">
        <Input
          autoComplete="current-password"
          id={`${role}-password`}
          maxLength={256}
          name="password"
          required
          type="password"
        />
      </Field>

      {requiresMfa ? (
        <Field
          hint="Enter the current six-digit code from the authenticator enrolled for this account."
          htmlFor={`${role}-verification-code`}
          label="Authenticator code"
        >
          <Input
            autoComplete="one-time-code"
            id={`${role}-verification-code`}
            inputMode="numeric"
            maxLength={6}
            name="verificationCode"
            pattern="[0-9]{6}"
            required
          />
        </Field>
      ) : null}

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Button disabled={pending} fullWidth type="submit">
        {pending ? "Signing in securely…" : "Sign in"}
      </Button>

      <p className="muted-copy">
        <Link href={`/auth/recover?portal=${role}`}>Forgot or reset password</Link>
      </p>
    </form>
  );
}
