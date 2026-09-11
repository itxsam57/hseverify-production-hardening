"use client";

import { useActionState } from "react";

import {
  signInWorker,
  type WorkerLoginState
} from "@/app/worker/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";

const initialState: WorkerLoginState = { error: null };

export function WorkerLoginForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(signInWorker, initialState);

  return (
    <form action={action} className="auth-form" noValidate>
      <Field htmlFor="email" label="Email address">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          maxLength={254}
          required
        />
      </Field>

      <Field htmlFor="password" label="Password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={256}
          required
        />
      </Field>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Button disabled={pending} fullWidth type="submit">
        {pending ? "Signing in…" : "Sign in to Worker Portal"}
      </Button>
    </form>
  );
}
