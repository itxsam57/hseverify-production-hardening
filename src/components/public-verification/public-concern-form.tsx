"use client";

import { useActionState } from "react";

import { submitPublicConcernAction } from "@/app/contact/actions";
import { INITIAL_PUBLIC_CONCERN_ACTION_STATE } from "@/lib/public-verification/public-concern-action-state";

export function PublicConcernForm({
  publicToken,
  idempotencyNonce
}: {
  publicToken: string;
  idempotencyNonce: string;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    submitPublicConcernAction,
    INITIAL_PUBLIC_CONCERN_ACTION_STATE
  );

  return (
    <form action={action} className="public-verification-form">
      <input type="hidden" name="publicToken" value={publicToken} />
      <input type="hidden" name="idempotencyNonce" value={idempotencyNonce} />

      <div className="field-stack">
        <label htmlFor="public-concern-category">Concern type</label>
        <select id="public-concern-category" name="category" defaultValue="" required>
          <option value="" disabled>Select a concern</option>
          <option value="identity_mismatch">Identity mismatch</option>
          <option value="suspected_fraud">Suspected fraud or copied result</option>
          <option value="status_dispute">Status dispute</option>
          <option value="document_concern">Document concern</option>
          <option value="other">Other concern</option>
        </select>
      </div>

      <div className="field-stack">
        <label htmlFor="public-concern-description">What is wrong?</label>
        <textarea
          id="public-concern-description"
          name="description"
          minLength={10}
          maxLength={4000}
          required
          rows={6}
          placeholder="Describe what you noticed and why the public verification result concerns you."
        />
      </div>

      <div className="field-stack">
        <label htmlFor="public-concern-name">Your name (optional)</label>
        <input id="public-concern-name" name="contactName" maxLength={160} autoComplete="name" />
      </div>

      <div className="field-stack">
        <label htmlFor="public-concern-email">Email</label>
        <input
          id="public-concern-email"
          name="contactEmail"
          type="email"
          maxLength={320}
          autoComplete="email"
          placeholder="name@example.com"
        />
      </div>

      <div className="field-stack">
        <label htmlFor="public-concern-phone">Phone</label>
        <input
          id="public-concern-phone"
          name="contactPhone"
          type="tel"
          maxLength={32}
          autoComplete="tel"
          placeholder="+966..."
        />
        <p className="muted-copy">Provide at least an email address or phone number so the concern can be followed up.</p>
      </div>

      <div className="field-stack">
        <label htmlFor="public-concern-evidence">Evidence (optional)</label>
        <input
          id="public-concern-evidence"
          name="evidence"
          type="file"
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        />
        <p className="muted-copy">
          PDF, PNG, JPG or JPEG only. Evidence is stored privately and is not attached to the concern until its malware scan completes successfully.
        </p>
      </div>

      <button className="button button-primary" type="submit" disabled={pending}>
        {pending ? "Submitting concern…" : "Submit concern"}
      </button>

      <div aria-live="polite" className="public-form-status">
        {state.message ? <p>{state.message}</p> : null}
        {state.status === "success" && state.concernReference ? (
          <p><strong>Concern reference:</strong> {state.concernReference}</p>
        ) : null}
      </div>
    </form>
  );
}
