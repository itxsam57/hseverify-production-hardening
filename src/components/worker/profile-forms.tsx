"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  requestWorkerProfileCorrectionAction,
  saveWorkerProfileSectionAction,
  submitWorkerProfileAction
} from "@/app/worker/profile/actions";
import {
  INITIAL_PROFILE_ACTION_STATE,
  type ProfileActionState
} from "@/lib/worker/profile-action-state";
import type {
  ProfileSection,
  WorkerProfileRecord
} from "@/lib/worker/profile-domain";

function ActionFeedback({ state }: { state: ProfileActionState }): React.JSX.Element | null {
  if (state.status === "idle") return null;

  return (
    <p
      className={`profile-action-message profile-action-${state.status}`}
      role={state.status === "error" || state.status === "conflict" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function FieldError({ state, name }: { state: ProfileActionState; name: string }): React.JSX.Element | null {
  const error = state.fieldErrors[name];
  return error ? (
    <span className="profile-field-error" id={`${name}-error`}>{error}</span>
  ) : null;
}

function SubmitButton({
  children,
  intent,
  secondary = false,
  disabled = false
}: {
  children: React.ReactNode;
  intent?: string;
  secondary?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const { pending } = useFormStatus();
  return (
    <button
      className={secondary ? "button button-secondary" : "button button-primary"}
      type="submit"
      name={intent ? "intent" : undefined}
      value={intent}
      disabled={disabled || pending}
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function useRefreshAfterAction(state: ProfileActionState): void {
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      if (state.nextSection) {
        router.push(`/worker/profile?section=${state.nextSection}`);
      } else {
        router.refresh();
      }
    } else if (state.status === "conflict") {
      router.refresh();
    }
  }, [router, state.nextSection, state.status]);
}

function FormActions({ hasNext }: { hasNext: boolean }): React.JSX.Element {
  return (
    <div className="profile-form-actions">
      <SubmitButton secondary>Save changes</SubmitButton>
      {hasNext ? <SubmitButton intent="continue">Save and continue</SubmitButton> : null}
    </div>
  );
}

function PersonalForm({ record }: { record: WorkerProfileRecord }): React.JSX.Element {
  const [state, action] = useActionState(saveWorkerProfileSectionAction, INITIAL_PROFILE_ACTION_STATE);
  useRefreshAfterAction(state);
  const locked = record.sensitiveFieldsLocked;

  return (
    <form action={action} className="profile-form" noValidate>
      <input type="hidden" name="section" value="personal" />
      <input type="hidden" name="expectedVersion" value={record.version} />

      {locked ? (
        <div className="profile-lock-notice">
          <strong>Verified identity details are locked</strong>
          <p>Legal name, date of birth and nationality require a correction request. Other profile fields remain editable.</p>
        </div>
      ) : null}

      <div className="profile-field-grid">
        <label className="profile-field">
          <span>Legal first name</span>
          <input name="legalFirstName" defaultValue={record.personal.legalFirstName} disabled={locked} required />
          {locked ? <input type="hidden" name="legalFirstName" value={record.personal.legalFirstName} /> : null}
          <FieldError state={state} name="legalFirstName" />
        </label>
        <label className="profile-field">
          <span>Legal last name</span>
          <input name="legalLastName" defaultValue={record.personal.legalLastName} disabled={locked} required />
          {locked ? <input type="hidden" name="legalLastName" value={record.personal.legalLastName} /> : null}
          <FieldError state={state} name="legalLastName" />
        </label>
        <label className="profile-field">
          <span>Preferred name <small>Optional</small></span>
          <input name="preferredName" defaultValue={record.personal.preferredName} />
          <FieldError state={state} name="preferredName" />
        </label>
        <label className="profile-field">
          <span>Date of birth</span>
          <input type="date" name="dateOfBirth" defaultValue={record.personal.dateOfBirth} disabled={locked} required />
          {locked ? <input type="hidden" name="dateOfBirth" value={record.personal.dateOfBirth} /> : null}
          <FieldError state={state} name="dateOfBirth" />
        </label>
        <label className="profile-field">
          <span>Nationality</span>
          <input name="nationality" defaultValue={record.personal.nationality} disabled={locked} required />
          {locked ? <input type="hidden" name="nationality" value={record.personal.nationality} /> : null}
          <FieldError state={state} name="nationality" />
        </label>
        <label className="profile-field">
          <span>Country of residence</span>
          <input name="countryOfResidence" defaultValue={record.personal.countryOfResidence} required />
          <FieldError state={state} name="countryOfResidence" />
        </label>
        <label className="profile-field">
          <span>Primary language</span>
          <input name="primaryLanguage" defaultValue={record.personal.primaryLanguage} required />
          <FieldError state={state} name="primaryLanguage" />
        </label>
      </div>

      <ActionFeedback state={state} />
      <FormActions hasNext />
    </form>
  );
}

function ContactForm({ record }: { record: WorkerProfileRecord }): React.JSX.Element {
  const [state, action] = useActionState(saveWorkerProfileSectionAction, INITIAL_PROFILE_ACTION_STATE);
  useRefreshAfterAction(state);

  return (
    <form action={action} className="profile-form" noValidate>
      <input type="hidden" name="section" value="contact" />
      <input type="hidden" name="expectedVersion" value={record.version} />
      <div className="profile-field-grid">
        <label className="profile-field profile-field-small">
          <span>Country code</span>
          <input name="phoneCountryCode" inputMode="tel" placeholder="+92" defaultValue={record.contact.phoneCountryCode} required />
          <FieldError state={state} name="phoneCountryCode" />
        </label>
        <label className="profile-field">
          <span>Phone number</span>
          <input name="phoneNumber" inputMode="tel" autoComplete="tel-national" defaultValue={record.contact.phoneNumber} required />
          <FieldError state={state} name="phoneNumber" />
        </label>
        <label className="profile-field profile-field-wide">
          <span>Address line 1</span>
          <input name="addressLine1" autoComplete="address-line1" defaultValue={record.contact.addressLine1} required />
          <FieldError state={state} name="addressLine1" />
        </label>
        <label className="profile-field profile-field-wide">
          <span>Address line 2 <small>Optional</small></span>
          <input name="addressLine2" autoComplete="address-line2" defaultValue={record.contact.addressLine2} />
          <FieldError state={state} name="addressLine2" />
        </label>
        <label className="profile-field">
          <span>City</span>
          <input name="city" autoComplete="address-level2" defaultValue={record.contact.city} required />
          <FieldError state={state} name="city" />
        </label>
        <label className="profile-field">
          <span>Region or province <small>Optional</small></span>
          <input name="region" autoComplete="address-level1" defaultValue={record.contact.region} />
          <FieldError state={state} name="region" />
        </label>
        <label className="profile-field">
          <span>Postal code <small>Optional</small></span>
          <input name="postalCode" autoComplete="postal-code" defaultValue={record.contact.postalCode} />
          <FieldError state={state} name="postalCode" />
        </label>
      </div>
      <ActionFeedback state={state} />
      <FormActions hasNext />
    </form>
  );
}

function ProfessionalForm({ record }: { record: WorkerProfileRecord }): React.JSX.Element {
  const [state, action] = useActionState(saveWorkerProfileSectionAction, INITIAL_PROFILE_ACTION_STATE);
  useRefreshAfterAction(state);

  return (
    <form action={action} className="profile-form" noValidate>
      <input type="hidden" name="section" value="professional" />
      <input type="hidden" name="expectedVersion" value={record.version} />
      <div className="profile-field-grid">
        <label className="profile-field profile-field-wide">
          <span>Primary occupation or trade</span>
          <input name="primaryOccupation" defaultValue={record.professional.primaryOccupation} required />
          <FieldError state={state} name="primaryOccupation" />
        </label>
        <label className="profile-field">
          <span>Years of experience</span>
          <input type="number" name="yearsExperience" min={0} max={70} step={1} defaultValue={record.professional.yearsExperience ?? ""} required />
          <FieldError state={state} name="yearsExperience" />
        </label>
        <label className="profile-field">
          <span>Current employment status</span>
          <select name="employmentStatus" defaultValue={record.professional.employmentStatus} required>
            <option value="">Select status</option>
            <option value="employed">Employed</option>
            <option value="self_employed">Self-employed</option>
            <option value="unemployed">Unemployed</option>
            <option value="student">Student or trainee</option>
            <option value="other">Other</option>
          </select>
          <FieldError state={state} name="employmentStatus" />
        </label>
        <label className="profile-field profile-field-wide">
          <span>Preferred work countries <small>Optional</small></span>
          <input name="preferredWorkCountries" defaultValue={record.professional.preferredWorkCountries} placeholder="For example: Saudi Arabia, UAE, Pakistan" />
          <FieldError state={state} name="preferredWorkCountries" />
        </label>
        <label className="profile-checkbox profile-field-wide">
          <input type="checkbox" name="willingToRelocate" defaultChecked={record.professional.willingToRelocate} />
          <span>I am willing to relocate for suitable work.</span>
        </label>
      </div>
      <ActionFeedback state={state} />
      <FormActions hasNext={false} />
    </form>
  );
}

export function ProfileSectionForm({
  section,
  record
}: {
  section: ProfileSection;
  record: WorkerProfileRecord;
}): React.JSX.Element {
  switch (section) {
    case "personal": return <PersonalForm record={record} />;
    case "contact": return <ContactForm record={record} />;
    case "professional": return <ProfessionalForm record={record} />;
  }
}

export function ProfileSubmitForm({
  record,
  completion
}: {
  record: WorkerProfileRecord;
  completion: number;
}): React.JSX.Element {
  const [state, action] = useActionState(submitWorkerProfileAction, INITIAL_PROFILE_ACTION_STATE);
  useRefreshAfterAction(state);

  if (record.status === "submitted") {
    return (
      <div className="profile-submit-card profile-submitted-card">
        <strong>Profile submitted</strong>
        <p>Your committed profile is available to the next approved workflow stage.</p>
      </div>
    );
  }

  return (
    <form action={action} className="profile-submit-card">
      <input type="hidden" name="expectedVersion" value={record.version} />
      <div>
        <strong>{completion === 100 ? "Ready to submit" : "Profile not ready"}</strong>
        <p>{completion === 100 ? "Submitting records this version as your complete worker profile." : "Complete every required section before submitting."}</p>
      </div>
      <SubmitButton intent="submit" disabled={completion !== 100}>Submit profile</SubmitButton>
      <ActionFeedback state={state} />
    </form>
  );
}

export function ProfileCorrectionForm({ record }: { record: WorkerProfileRecord }): React.JSX.Element | null {
  const [state, action] = useActionState(requestWorkerProfileCorrectionAction, INITIAL_PROFILE_ACTION_STATE);
  useRefreshAfterAction(state);

  if (!record.sensitiveFieldsLocked) return null;

  if (record.correctionRequest?.status === "pending") {
    return (
      <section className="profile-correction-card" aria-labelledby="correction-heading">
        <p className="section-kicker">Identity-linked details</p>
        <h2 id="correction-heading">Correction request pending</h2>
        <p>Your proposed legal identity changes are waiting for review. Current verified values remain active until a decision is recorded.</p>
      </section>
    );
  }

  return (
    <section className="profile-correction-card" aria-labelledby="correction-heading">
      <p className="section-kicker">Identity-linked details</p>
      <h2 id="correction-heading">Request a verified-detail correction</h2>
      <p>This request records proposed values separately and never overwrites the active verified record.</p>
      <form action={action} className="profile-form" noValidate>
        <input type="hidden" name="expectedVersion" value={record.version} />
        <div className="profile-field-grid">
          <label className="profile-field">
            <span>Proposed legal first name</span>
            <input name="legalFirstName" defaultValue={record.personal.legalFirstName} required />
            <FieldError state={state} name="legalFirstName" />
          </label>
          <label className="profile-field">
            <span>Proposed legal last name</span>
            <input name="legalLastName" defaultValue={record.personal.legalLastName} required />
            <FieldError state={state} name="legalLastName" />
          </label>
          <label className="profile-field">
            <span>Proposed date of birth</span>
            <input type="date" name="dateOfBirth" defaultValue={record.personal.dateOfBirth} required />
            <FieldError state={state} name="dateOfBirth" />
          </label>
          <label className="profile-field">
            <span>Proposed nationality</span>
            <input name="nationality" defaultValue={record.personal.nationality} required />
            <FieldError state={state} name="nationality" />
          </label>
          <label className="profile-field profile-field-wide">
            <span>Reason and supporting context</span>
            <textarea name="reason" rows={5} minLength={20} maxLength={1000} required />
            <FieldError state={state} name="reason" />
          </label>
        </div>
        <ActionFeedback state={state} />
        <div className="profile-form-actions">
          <SubmitButton>Submit correction request</SubmitButton>
        </div>
      </form>
    </section>
  );
}
