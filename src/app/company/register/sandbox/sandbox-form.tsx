"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  readCompanySandboxDelivery,
  type CompanySandboxState
} from "@/app/company/register/sandbox/actions";
import styles from "@/app/worker/register/registration.module.css";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";

const INITIAL_COMPANY_SANDBOX_STATE: CompanySandboxState = Object.freeze({
  error: null,
  code: null,
  deliveryHint: null,
  createdAt: null
});

export function CompanyRegistrationSandboxForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(
    readCompanySandboxDelivery,
    INITIAL_COMPANY_SANDBOX_STATE
  );
  return (
    <>
      <Alert tone="warning">
        Development/test sandbox only. Preview and production never expose verification codes here.
      </Alert>
      <form action={action} className={styles.sandboxPanel} noValidate>
        <Field htmlFor="destination" label="Business email">
          <Input id="destination" name="destination" type="email" autoComplete="off" maxLength={254} required />
        </Field>
        <Field htmlFor="accessKey" label="Sandbox access key">
          <Input id="accessKey" name="accessKey" type="password" autoComplete="off" maxLength={256} required />
        </Field>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        <Button disabled={pending} fullWidth type="submit">
          {pending ? "Opening encrypted delivery…" : "Open latest email code"}
        </Button>
      </form>
      {state.code ? (
        <section className={styles.sandboxResult} aria-label="Latest Company registration code" role="status">
          <span>Latest code for {state.deliveryHint}</span>
          <strong className={styles.sandboxCode}>{state.code}</strong>
          <span className={styles.sandboxNote}>
            Created {state.createdAt ? new Date(state.createdAt).toLocaleString() : "recently"}.
          </span>
        </section>
      ) : null}
      <div className={styles.linkRow}>
        <Link href="/company/register/verify">Return to Company verification</Link>
        <Link href="/company/register">Start Company registration</Link>
      </div>
    </>
  );
}
