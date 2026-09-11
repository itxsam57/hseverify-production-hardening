"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  startCompanyRegistrationAction,
  verifyCompanyEmailAction,
  verifyCompanyMfaAction,
  type CompanyRegistrationActionState
} from "@/app/company/register/actions";
import styles from "@/app/worker/register/registration.module.css";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, Input, Select } from "@/components/ui/field";

const INITIAL_COMPANY_REGISTRATION_ACTION_STATE: CompanyRegistrationActionState = Object.freeze({
  status: "idle",
  message: null,
  retryAt: null,
  fieldErrors: Object.freeze({})
});

function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

function ActionAlert({ state }: { state: CompanyRegistrationActionState }): React.JSX.Element | null {
  if (!state.message) return null;
  return <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert>;
}

export function CompanyRegistrationForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(
    startCompanyRegistrationAction,
    INITIAL_COMPANY_REGISTRATION_ACTION_STATE
  );
  const errors = state.fieldErrors;
  return (
    <>
      <ActionAlert state={state} />
      <form action={action} className={styles.formGrid} noValidate>
        <Field error={errors.legalName} htmlFor="legalName" label="Legal Company name">
          <Input id="legalName" name="legalName" maxLength={180} required aria-invalid={Boolean(errors.legalName)} />
        </Field>
        <Field error={errors.tradingName} htmlFor="tradingName" label="Trading name">
          <Input id="tradingName" name="tradingName" maxLength={180} required aria-invalid={Boolean(errors.tradingName)} />
        </Field>
        <Field error={errors.registrationNumber} htmlFor="registrationNumber" label="Registration number">
          <Input id="registrationNumber" name="registrationNumber" maxLength={120} required aria-invalid={Boolean(errors.registrationNumber)} />
        </Field>
        <Field error={errors.country} htmlFor="country" label="Registration country">
          <Input id="country" name="country" maxLength={120} required aria-invalid={Boolean(errors.country)} />
        </Field>
        <Field error={errors.industry} htmlFor="industry" label="Industry">
          <Input id="industry" name="industry" maxLength={160} required aria-invalid={Boolean(errors.industry)} />
        </Field>
        <Field error={errors.companySize} htmlFor="companySize" label="Company size">
          <Select id="companySize" name="companySize" required defaultValue="" aria-invalid={Boolean(errors.companySize)}>
            <option disabled value="">Select Company size</option>
            <option value="1-10">1–10</option>
            <option value="11-50">11–50</option>
            <option value="51-200">51–200</option>
            <option value="201-500">201–500</option>
            <option value="501-1000">501–1,000</option>
            <option value="1001-5000">1,001–5,000</option>
            <option value="5001+">5,001+</option>
          </Select>
        </Field>
        <Field error={errors.website} htmlFor="website" label="Company website">
          <Input id="website" name="website" type="url" placeholder="https://example.com" maxLength={240} required aria-invalid={Boolean(errors.website)} />
        </Field>
        <Field error={errors.authorizedRepresentative} htmlFor="authorizedRepresentative" label="Authorized representative">
          <Input id="authorizedRepresentative" name="authorizedRepresentative" autoComplete="name" maxLength={160} required aria-invalid={Boolean(errors.authorizedRepresentative)} />
        </Field>
        <Field error={errors.businessEmail} htmlFor="businessEmail" label="Business email">
          <Input id="businessEmail" name="businessEmail" type="email" autoComplete="email" maxLength={254} required aria-invalid={Boolean(errors.businessEmail)} />
        </Field>
        <Field error={errors.businessPhone} hint="Use international format, for example +966501234567." htmlFor="businessPhone" label="Business phone">
          <Input id="businessPhone" name="businessPhone" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} required aria-describedby={describedBy("businessPhone-hint", errors.businessPhone && "businessPhone-error")} aria-invalid={Boolean(errors.businessPhone)} />
        </Field>
        <Field error={errors.password} hint="Use at least 12 characters and the existing HSE Verify password rules." htmlFor="password" label="Create password">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required aria-invalid={Boolean(errors.password)} />
        </Field>
        <Field error={errors.confirmPassword} htmlFor="confirmPassword" label="Confirm password">
          <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required aria-invalid={Boolean(errors.confirmPassword)} />
        </Field>
        <div>
          <CheckboxField name="termsAccepted" required label="I accept the HSE Verify terms for this Company application." />
          {errors.termsAccepted ? <p className="ds-field-error" role="alert">{errors.termsAccepted}</p> : null}
        </div>
        <div>
          <CheckboxField name="privacyAccepted" required label="I accept the privacy notice for Company verification data and evidence." />
          {errors.privacyAccepted ? <p className="ds-field-error" role="alert">{errors.privacyAccepted}</p> : null}
        </div>
        <Button disabled={pending} fullWidth type="submit">
          {pending ? "Creating Company application…" : "Create Company application"}
        </Button>
      </form>
      <div className={styles.linkRow}>
        <Link href="/company/login">Company sign-in</Link>
        <Link href="/">Exit</Link>
      </div>
    </>
  );
}

export function CompanyEmailVerificationForm({
  deliveryHint,
  statusMessage,
  sandboxEnabled
}: {
  deliveryHint: string | null;
  statusMessage: string | null;
  sandboxEnabled: boolean;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    verifyCompanyEmailAction,
    INITIAL_COMPANY_REGISTRATION_ACTION_STATE
  );
  return (
    <>
      {deliveryHint ? <p className={styles.deliveryLine}>Code sent to <strong>{deliveryHint}</strong></p> : null}
      {statusMessage ? <Alert tone="success">{statusMessage}</Alert> : null}
      <ActionAlert state={state} />
      <form action={action} className={styles.formGrid} noValidate>
        <Field error={state.fieldErrors.code} htmlFor="code" label="Email verification code">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required aria-invalid={Boolean(state.fieldErrors.code)} />
        </Field>
        <Button disabled={pending} fullWidth type="submit">{pending ? "Verifying…" : "Verify business email"}</Button>
      </form>
      <div className={styles.secondaryActions}>
        <form action="/company/register/verify/resend" method="post">
          <Button fullWidth type="submit" variant="secondary">Send new code</Button>
        </form>
        {sandboxEnabled ? <Link className="ds-button ds-button-secondary ds-button-full" href="/company/register/sandbox">Open sandbox inbox</Link> : null}
      </div>
    </>
  );
}

export function CompanyMfaVerificationForm({
  setupKey
}: {
  setupKey: string;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    verifyCompanyMfaAction,
    INITIAL_COMPANY_REGISTRATION_ACTION_STATE
  );
  return (
    <>
      <Alert tone="warning">
        Add this setup key to your authenticator app. The Company account cannot sign in until a valid code is confirmed.
      </Alert>
      <div className="existing-session-card">
        <p className="eyebrow">Authenticator setup key</p>
        <code>{setupKey}</code>
      </div>
      <ActionAlert state={state} />
      <form action={action} className={styles.formGrid} noValidate>
        <Field error={state.fieldErrors.code} htmlFor="code" label="Authenticator code">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required aria-invalid={Boolean(state.fieldErrors.code)} />
        </Field>
        <Button disabled={pending} fullWidth type="submit">{pending ? "Activating…" : "Activate Company account"}</Button>
      </form>
    </>
  );
}
