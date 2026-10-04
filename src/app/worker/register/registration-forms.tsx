"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useSyncExternalStore } from "react";

import {
  cancelWorkerRegistration,
  startWorkerRegistration,
  type RegistrationActionState
} from "@/app/worker/register/actions";
import styles from "@/app/worker/register/registration.module.css";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { CheckboxField, Field, Input } from "@/components/ui/field";
import { PRODUCT_COPY } from "@/config/product-copy";
import { WORKER_REGISTRATION_POLICY } from "@/lib/auth/worker-registration-policy";

const INITIAL_STATE: RegistrationActionState = {
  error: null,
  message: null,
  retryAt: null
};

function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

function subscribeToRegistrationReadiness(): () => void {
  return () => {};
}

export function WorkerRegistrationForm({
  cancelled = false,
  companyInvitation = false
}: {
  cancelled?: boolean;
  companyInvitation?: boolean;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    startWorkerRegistration,
    INITIAL_STATE
  );
  const ready = useSyncExternalStore(subscribeToRegistrationReadiness, () => true, () => false);
  const [draft, setDraft] = useState({
    displayName: "", email: "", phone: "", country: "",
    password: "", confirmPassword: "", companyCode: "",
    termsAccepted: false, privacyAccepted: false
  });
  function updateText(event: React.ChangeEvent<HTMLInputElement>): void {
    const { name, value } = event.currentTarget;
    setDraft(current => ({ ...current, [name]: value }));
  }
  function updateAcceptance(event: React.ChangeEvent<HTMLInputElement>): void {
    const { name, checked } = event.currentTarget;
    setDraft(current => ({ ...current, [name]: checked }));
  }
  const errors = state.fieldErrors ?? {};
  const copy = PRODUCT_COPY.workerRegistration;

  return (
    <>
      {cancelled ? (
        <Alert tone="success">The previous registration attempt was cancelled.</Alert>
      ) : null}
      {companyInvitation ? (
        <Alert tone="neutral">
          A verified Company invitation is attached to this registration. Use the invited email address. The Company link activates only after both contact checks pass.
        </Alert>
      ) : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <form action={action} className={styles.formGrid} noValidate>
        <Field error={errors.displayName} htmlFor="displayName" label="Full name">
          <Input
            disabled={!ready}
            aria-describedby={describedBy(errors.displayName && "displayName-error")}
            aria-invalid={Boolean(errors.displayName)}
            autoComplete="name"
            id="displayName"
            value={draft.displayName}
            onChange={updateText}
            maxLength={120}
            name="displayName"
            required
          />
        </Field>

        <Field error={errors.email} htmlFor="email" label="Email address">
          <Input
            disabled={!ready}
            aria-describedby={describedBy(errors.email && "email-error")}
            aria-invalid={Boolean(errors.email)}
            autoComplete="email"
            id="email"
            value={draft.email}
            onChange={updateText}
            inputMode="email"
            maxLength={254}
            name="email"
            required
            type="email"
          />
        </Field>

        <Field
          error={errors.phone}
          hint={copy.phoneHint}
          htmlFor="phone"
          label="Mobile phone"
        >
          <Input
            disabled={!ready}
            aria-describedby={describedBy("phone-hint", errors.phone && "phone-error")}
            aria-invalid={Boolean(errors.phone)}
            autoComplete="tel"
            id="phone"
            value={draft.phone}
            onChange={updateText}
            inputMode="tel"
            maxLength={20}
            name="phone"
            placeholder="+923001234567"
            required
            type="tel"
          />
        </Field>

        <Field error={errors.country} htmlFor="country" label="Country">
          <Input
            disabled={!ready}
            aria-describedby={describedBy(errors.country && "country-error")}
            aria-invalid={Boolean(errors.country)}
            autoComplete="country-name"
            id="country"
            value={draft.country}
            onChange={updateText}
            maxLength={100}
            name="country"
            required
          />
        </Field>

        <Field error={errors.password} htmlFor="password" label="Create password">
          <Input
            disabled={!ready}
            aria-describedby={describedBy(
              "password-guidance",
              errors.password && "password-error"
            )}
            aria-invalid={Boolean(errors.password)}
            autoComplete="new-password"
            id="password"
            value={draft.password}
            onChange={updateText}
            maxLength={128}
            minLength={12}
            name="password"
            required
            type="password"
          />
        </Field>

        <Field
          error={errors.confirmPassword}
          htmlFor="confirmPassword"
          label="Confirm password"
        >
          <Input
            disabled={!ready}
            aria-describedby={describedBy(
              "password-guidance",
              errors.confirmPassword && "confirmPassword-error"
            )}
            aria-invalid={Boolean(errors.confirmPassword)}
            autoComplete="new-password"
            id="confirmPassword"
            value={draft.confirmPassword}
            onChange={updateText}
            maxLength={128}
            minLength={12}
            name="confirmPassword"
            required
            type="password"
          />
        </Field>

        <Field
          error={errors.companyCode}
          htmlFor="companyCode"
          label="Company registration code"
          optional
          hint={companyInvitation
            ? "Leave this blank because a Company invitation is already attached."
            : "If a verified Company gave you a registration code, enter it here. You can also register independently and join later."}
        >
          <Input
            aria-describedby={describedBy("companyCode-hint", errors.companyCode && "companyCode-error")}
            aria-invalid={Boolean(errors.companyCode)}
            autoComplete="off"
            disabled={!ready || companyInvitation}
            id="companyCode"
            value={draft.companyCode}
            onChange={updateText}
            maxLength={160}
            name="companyCode"
          />
        </Field>

        <p className={styles.passwordNote} id="password-guidance">
          {copy.passwordHint}
        </p>
        <p className={styles.passwordNote}>{copy.verificationOrder}</p>

        <div>
          <CheckboxField
            disabled={!ready}
            aria-describedby={describedBy(errors.termsAccepted && "termsAccepted-error")}
            aria-invalid={Boolean(errors.termsAccepted)}
            name="termsAccepted"
            checked={draft.termsAccepted}
            onChange={updateAcceptance}
            required
            label={WORKER_REGISTRATION_POLICY.termsLabel}
          />
          {errors.termsAccepted ? <p className="ds-field-error" id="termsAccepted-error" role="alert">{errors.termsAccepted}</p> : null}
        </div>
        <div>
          <CheckboxField
            disabled={!ready}
            aria-describedby={describedBy(errors.privacyAccepted && "privacyAccepted-error")}
            aria-invalid={Boolean(errors.privacyAccepted)}
            name="privacyAccepted"
            checked={draft.privacyAccepted}
            onChange={updateAcceptance}
            required
            label={WORKER_REGISTRATION_POLICY.privacyLabel}
          />
          {errors.privacyAccepted ? <p className="ds-field-error" id="privacyAccepted-error" role="alert">{errors.privacyAccepted}</p> : null}
        </div>

        <Button disabled={pending || !ready} fullWidth type="submit">
          {pending ? "Creating account…" : "Create Worker account"}
        </Button>
      </form>

      <div className={styles.linkRow}>
        <Link href="/worker/login">Worker sign-in</Link>
        <Link href="/">Exit</Link>
      </div>
    </>
  );
}

function secondsUntil(value: string | null, now: number): number {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - now) / 1000));
}

function formatSeconds(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function WorkerVerificationForm({
  step,
  challengeId,
  deliveryHint,
  resendAvailableAt,
  challengeExpiresAt,
  sandboxEnabled,
  errorMessage,
  statusMessage
}: {
  step: "pending_email" | "pending_phone";
  challengeId: string | null;
  deliveryHint: string;
  resendAvailableAt: string | null;
  challengeExpiresAt: string | null;
  sandboxEnabled: boolean;
  errorMessage: string | null;
  statusMessage: string | null;
}): React.JSX.Element {
  const [nowTick, setNowTick] = useState<number | null>(null);

  useEffect(() => {
    const updateClock = () => setNowTick(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const resendSeconds =
    nowTick === null ? null : secondsUntil(resendAvailableAt, nowTick);
  const expirySeconds =
    nowTick === null ? null : secondsUntil(challengeExpiresAt, nowTick);
  const isEmail = step === "pending_email";
  const copy = PRODUCT_COPY.workerRegistration;
  const verifyDisabled = !challengeId || expirySeconds === 0;

  return (
    <>
      <p className={styles.stepLine}>
        Step {isEmail ? "1 of 2" : "2 of 2"}: {isEmail ? "email" : "phone"}
      </p>
      <p className={styles.deliveryLine}>
        Code sent to <strong>{deliveryHint}</strong>
      </p>

      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      {statusMessage ? <Alert tone="success">{statusMessage}</Alert> : null}

      <form
        action="/worker/register/verify/submit"
        className={styles.formGrid}
        method="post"
      >
        <input name="challengeId" type="hidden" value={challengeId ?? ""} />
        <Field hint={copy.codeHint} htmlFor="code" label="Verification code">
          <Input
            aria-describedby="code-hint"
            aria-invalid={Boolean(errorMessage)}
            autoComplete="one-time-code"
            className={styles.codeInput}
            id="code"
            inputMode="numeric"
            maxLength={6}
            minLength={6}
            name="code"
            pattern="[0-9]{6}"
            required
          />
        </Field>

        <p aria-live="polite" className={styles.verificationMeta}>
          {expirySeconds === null
            ? "Checking expiry…"
            : expirySeconds > 0
              ? `Expires in ${formatSeconds(expirySeconds)}.`
              : "Expired. Request a new code."}
        </p>

        <Button disabled={verifyDisabled} fullWidth type="submit">
          {isEmail ? "Verify email" : "Verify phone"}
        </Button>
      </form>

      <div className={styles.secondaryActions}>
        <form action="/worker/register/verify/resend" method="post">
          <Button
            disabled={resendSeconds === null || resendSeconds > 0}
            fullWidth
            type="submit"
            variant="secondary"
          >
            {resendSeconds === null
              ? "Checking resend time…"
              : resendSeconds > 0
                ? `Resend in ${formatSeconds(resendSeconds)}`
                : "Send new code"}
          </Button>
        </form>
        {sandboxEnabled ? (
          <Link
            aria-label="Open sandbox inbox"
            className="ds-button ds-button-secondary ds-button-full"
            href="/worker/register/sandbox"
          >
            {copy.sandboxLabel}
          </Link>
        ) : null}
      </div>

      <details className={styles.startOver}>
        <summary>Cancel this registration</summary>
        <form action={cancelWorkerRegistration}>
          <Button type="submit" variant="danger">
            Cancel and start again
          </Button>
        </form>
      </details>
    </>
  );
}
