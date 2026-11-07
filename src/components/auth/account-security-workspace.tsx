"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  changePasswordAction,
  confirmMfaReplacementAction,
  rotateRecoveryCodesAction,
  startMfaReplacementAction,
  type SecurityActionState
} from "@/app/account/security/actions";
import type { AccountSecurityOverview } from "@/lib/auth/account-security-service";

const INITIAL: SecurityActionState = { error: null, message: null };

function Result({ state }: { state: SecurityActionState }): React.JSX.Element | null {
  if (state.error) return <p className="status-banner status-error" role="alert">{state.error}</p>;
  if (state.message) return <p className="status-banner status-success" role="status">{state.message}</p>;
  return null;
}

export function AccountSecurityWorkspace({
  overview
}: {
  overview: AccountSecurityOverview;
}): React.JSX.Element {
  const [passwordState, passwordAction, passwordPending] = useActionState(changePasswordAction, INITIAL);
  const [recoveryState, recoveryAction, recoveryPending] = useActionState(rotateRecoveryCodesAction, INITIAL);
  const [rotationState, rotationAction, rotationPending] = useActionState(startMfaReplacementAction, INITIAL);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmMfaReplacementAction, INITIAL);

  return (
    <div className="stack-lg">
      <section className="surface-card" id="interface-language" aria-labelledby="interface-language-heading">
        <h2 id="interface-language-heading">Interface language</h2>
        <p><strong lang="en">English</strong></p>
        <p>This release is available in English.</p>
      </section>
      <section className="surface-card" aria-labelledby="password-security-heading">
        <h2 id="password-security-heading">Change password</h2>
        <p>Changing your password revokes every other active session while keeping this session available.</p>
        <form action={passwordAction} className="form-grid">
          <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
          <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
          <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
          {overview.mfaRequired ? <label>Current authenticator code<input name="mfaCode" inputMode="numeric" maxLength={6} required /></label> : null}
          <button className="button button-primary" disabled={passwordPending} type="submit">{passwordPending ? "Changing…" : "Change password"}</button>
        </form>
        <Result state={passwordState} />
      </section>

      <section className="surface-card" aria-labelledby="session-security-heading">
        <h2 id="session-security-heading">Active sessions</h2>
        <p>Review every active role-bound session and revoke a device or session you no longer trust.</p>
        <Link className="button button-secondary" href="/account/sessions">Review active sessions</Link>
      </section>

      {overview.mfaRequired ? (
        <section className="surface-card" aria-labelledby="mfa-security-heading">
          <h2 id="mfa-security-heading">Multi-factor authentication</h2>
          <p>Authenticator status: <strong>{overview.mfaActive ? "Active" : "Not active"}</strong></p>
          <p>Unused recovery codes: <strong>{overview.unusedRecoveryCodes}</strong></p>

          <details>
            <summary>Rotate recovery codes</summary>
            <form action={recoveryAction} className="form-grid">
              <label>Current password<input name="currentPassword" type="password" required /></label>
              <label>Current authenticator code<input name="mfaCode" inputMode="numeric" maxLength={6} required /></label>
              <button className="button button-secondary" disabled={recoveryPending} type="submit">{recoveryPending ? "Rotating…" : "Generate new recovery codes"}</button>
            </form>
            <Result state={recoveryState} />
            {recoveryState.recoveryCodes ? (
              <div className="status-banner" role="status">
                <strong>Save these one-time codes now.</strong>
                <ul>{recoveryState.recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
              </div>
            ) : null}
          </details>

          <details>
            <summary>Replace authenticator</summary>
            <form action={rotationAction} className="form-grid">
              <label>Current password<input name="currentPassword" type="password" required /></label>
              <label>Current authenticator code<input name="mfaCode" inputMode="numeric" maxLength={6} required /></label>
              <button className="button button-secondary" disabled={rotationPending} type="submit">{rotationPending ? "Starting…" : "Start authenticator replacement"}</button>
            </form>
            <Result state={rotationState} />
            {rotationState.mfaRotation ? (
              <div className="surface-card">
                <p>New authenticator secret: <code>{rotationState.mfaRotation.secret}</code></p>
                <p className="muted-copy">Setup URI: <code>{rotationState.mfaRotation.setupUri}</code></p>
                <form action={confirmAction} className="form-grid">
                  <input type="hidden" name="challengeId" value={rotationState.mfaRotation.challengeId} />
                  <label>Code from new authenticator<input name="newCode" inputMode="numeric" maxLength={6} required /></label>
                  <button className="button button-primary" disabled={confirmPending} type="submit">{confirmPending ? "Confirming…" : "Confirm replacement"}</button>
                </form>
                <Result state={confirmState} />
              </div>
            ) : null}
          </details>
        </section>
      ) : null}

      <section className="surface-card" aria-labelledby="security-activity-heading">
        <h2 id="security-activity-heading">Security activity</h2>
        {overview.securityEvents.length === 0 ? <p>No security activity recorded.</p> : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Event</th><th>Portal</th><th>Time</th></tr></thead>
              <tbody>
                {overview.securityEvents.map((event) => (
                  <tr key={event.eventId}>
                    <td>{event.eventType.replaceAll("_", " ")}</td>
                    <td>{event.role ?? "—"}</td>
                    <td>{new Date(event.occurredAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
