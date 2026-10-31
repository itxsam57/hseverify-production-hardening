"use client";

import { useActionState, useState } from "react";

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
  // React resets uncontrolled form fields after server-action submissions.
  // Preserve the visitor's entered draft when server-side validation rejects it.
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  return (
    <form action={action} className="public-verification-form">
      <input type="hidden" name="publicToken" value={publicToken} />
      <input type="hidden" name="idempotencyNonce" value={idempotencyNonce} />

      <div className="field-stack">
        <label htmlFor="public-concern-category">Concern type</label>
        <select id="public-concern-category" name="category" value={category} onChange={event => setCategory(event.target.value)} required>
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
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="Describe what you noticed and why the public verification result concerns you."
        />
      </div>

      <div className="field-stack">
        <label htmlFor="public-concern-name">Your name (optional)</label>
        <input id="public-concern-name" name="contactName" maxLength={160} autoComplete="name" value={contactName} onChange={event => setContactName(event.target.value)} />
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
          value={contactEmail}
          onChange={event => setContactEmail(event.target.value)}
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
          value={contactPhone}
          onChange={event => setContactPhone(event.target.value)}
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
