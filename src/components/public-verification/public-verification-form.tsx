"use client";

import { useActionState, useState } from "react";

import { verifyPublicIdentifierAction } from "@/app/verify/actions";
import { PublicQrScanner } from "@/components/public-verification/public-qr-scanner";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { INITIAL_PUBLIC_VERIFICATION_ACTION_STATE } from "@/lib/ui/action-initial-states";

export function PublicVerificationForm(): React.JSX.Element {
  const [identifier, setIdentifier] = useState("");
  const [state, action, pending] = useActionState(
    verifyPublicIdentifierAction,
    INITIAL_PUBLIC_VERIFICATION_ACTION_STATE
  );

  return (
    <div className="content-stack">
      {state.message ? (
        <Alert tone={state.status === "unavailable" ? "warning" : "danger"}>
          {state.message}
        </Alert>
      ) : null}

      <form action={action} className="profile-form" noValidate>
        <Field
          htmlFor="public-verification-identifier"
          label="Worker ID or Credential ID"
          hint="Example: worker_id_…"
        >
          <Input
            autoComplete="off"
            id="public-verification-identifier"
            maxLength={180}
            name="identifier"
            onChange={(event) => setIdentifier(event.currentTarget.value)}
            placeholder="Enter an HSE Verify ID"
            required
            spellCheck={false}
            value={identifier}
          />
        </Field>
        <div className="public-verification-actions">
          <Button disabled={pending || identifier.trim().length === 0} type="submit">
            {pending ? "Verifying…" : "Verify"}
          </Button>
          <PublicQrScanner onIdentifier={setIdentifier} />
        </div>
      </form>
    </div>
  );
}
