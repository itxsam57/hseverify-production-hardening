"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  readSandboxDelivery,
  type SandboxDeliveryState
} from "@/app/worker/register/actions";
import styles from "@/app/worker/register/registration.module.css";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";

const INITIAL_STATE: SandboxDeliveryState = {
  error: null,
  code: null,
  deliveryHint: null,
  createdAt: null
};

export function RegistrationSandboxForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(
    readSandboxDelivery,
    INITIAL_STATE
  );

  return (
    <>
      <Alert tone="warning">
        Development/test sandbox only. This page is unavailable in preview and production.
      </Alert>

      <form action={action} className={styles.sandboxPanel} noValidate>
        <Field htmlFor="channel" label="Delivery channel">
          <Select defaultValue="email" id="channel" name="channel" required>
            <option value="email">Email</option>
            <option value="phone">Phone</option>
          </Select>
        </Field>

        <Field
          hint="Enter the same email address or international phone number used during registration."
          htmlFor="destination"
          label="Delivery destination"
        >
          <Input
            aria-describedby="destination-hint"
            autoComplete="off"
            id="destination"
            maxLength={254}
            name="destination"
            required
          />
        </Field>

        <Field htmlFor="accessKey" label="Sandbox access key">
          <Input
            autoComplete="off"
            id="accessKey"
            maxLength={256}
            name="accessKey"
            required
            type="password"
          />
        </Field>

        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

        <Button disabled={pending} fullWidth type="submit">
          {pending ? "Opening encrypted delivery…" : "Open latest sandbox delivery"}
        </Button>
      </form>

      {state.code ? (
        <section
          aria-label="Latest sandbox verification code"
          className={styles.sandboxResult}
          role="status"
        >
          <span>Latest code for {state.deliveryHint}</span>
          <strong className={styles.sandboxCode}>{state.code}</strong>
          <span className={styles.sandboxNote}>
            Created {state.createdAt ? new Date(state.createdAt).toLocaleString() : "recently"}. The code is shown only after access-key verification.
          </span>
        </section>
      ) : null}

      <div className={styles.linkRow}>
        <Link href="/worker/register/verify">Return to verification</Link>
        <Link href="/worker/register">Start registration</Link>
      </div>
    </>
  );
}
