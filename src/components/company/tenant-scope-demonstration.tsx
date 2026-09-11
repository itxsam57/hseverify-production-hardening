"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  deleteCompanyScopeDemonstrationRecord,
  saveCompanyScopeDemonstrationAction
} from "@/app/company/(portal)/tenant-scope/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  INITIAL_COMPANY_SCOPE_DEMO_ACTION_STATE,
  type CompanyScopeDemoActionState,
  type CompanyScopeDemoViewRecord
} from "@/lib/authorization/company-scope-demonstration-domain";

function SubmitButton({
  idleLabel,
  pendingLabel,
  variant = "primary"
}: {
  idleLabel: string;
  pendingLabel: string;
  variant?: "primary" | "secondary";
}): React.JSX.Element {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} type="submit" variant={variant}>
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}

function ActionFeedback({
  state
}: {
  state: CompanyScopeDemoActionState;
}): React.JSX.Element | null {
  if (state.status === "idle") return null;
  const tone =
    state.status === "success"
      ? "success"
      : state.status === "conflict"
        ? "warning"
        : "danger";
  return <Alert tone={tone}>{state.message}</Alert>;
}

function FieldError({
  state,
  name
}: {
  state: CompanyScopeDemoActionState;
  name: string;
}): string | null {
  return state.fieldErrors[name] ?? null;
}

function CreateDemonstrationRecord(): React.JSX.Element {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(
    saveCompanyScopeDemonstrationAction,
    INITIAL_COMPANY_SCOPE_DEMO_ACTION_STATE
  );

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    } else if (state.status === "conflict") {
      router.refresh();
    }
  }, [router, state.status]);

  return (
    <form
      action={action}
      className="profile-form company-scope-form"
      noValidate
      ref={formRef}
    >
      <input name="intent" type="hidden" value="create" />
      <div className="profile-field-grid company-scope-field-grid">
        <Field
          error={FieldError({ state, name: "recordKey" })}
          hint="Lowercase letters, numbers, underscores and hyphens only. Unique inside this Company tenant."
          htmlFor="company-scope-create-key"
          label="Demonstration key"
        >
          <Input
            aria-describedby="company-scope-create-key-hint"
            autoComplete="off"
            id="company-scope-create-key"
            maxLength={64}
            name="recordKey"
            placeholder="example-control"
            required
          />
        </Field>
        <Field
          error={FieldError({ state, name: "title" })}
          htmlFor="company-scope-create-title"
          label="Title"
        >
          <Input
            id="company-scope-create-title"
            maxLength={80}
            name="title"
            placeholder="Current tenant demonstration"
            required
          />
        </Field>
        <Field
          className="profile-field-wide"
          error={FieldError({ state, name: "note" })}
          htmlFor="company-scope-create-note"
          label="Note"
          optional
        >
          <Textarea
            id="company-scope-create-note"
            maxLength={500}
            name="note"
            placeholder="Synthetic information only. Do not enter worker, company or production data."
            rows={4}
          />
        </Field>
      </div>
      <ActionFeedback state={state} />
      <div className="profile-form-actions">
        <SubmitButton
          idleLabel="Create demonstration record"
          pendingLabel="Creating…"
        />
      </div>
    </form>
  );
}

function RecordEditor({
  record
}: {
  record: CompanyScopeDemoViewRecord;
}): React.JSX.Element {
  const router = useRouter();
  const [state, action] = useActionState(
    saveCompanyScopeDemonstrationAction,
    INITIAL_COMPANY_SCOPE_DEMO_ACTION_STATE
  );

  useEffect(() => {
    if (state.status === "success" || state.status === "conflict") {
      router.refresh();
    }
  }, [router, state.status]);

  const deleteAction = deleteCompanyScopeDemonstrationRecord.bind(
    null,
    record.fixtureId
  );
  const keyId = `company-scope-key-${record.fixtureId}`;
  const titleId = `company-scope-title-${record.fixtureId}`;
  const noteId = `company-scope-note-${record.fixtureId}`;

  return (
    <article
      className="dashboard-section company-scope-record-card"
      data-company-scope-record={record.fixtureId}
    >
      <div className="page-heading-row">
        <div>
          <p className="section-kicker">Tenant-owned demonstration record</p>
          <h2>{record.title}</h2>
          <p className="page-intro">
            Version {record.version} · Updated {new Date(record.updatedAt).toLocaleString()}
          </p>
        </div>
      </div>

      <form action={action} className="profile-form" noValidate>
        <input name="intent" type="hidden" value="update" />
        <input name="fixtureId" type="hidden" value={record.fixtureId} />
        <input
          name="expectedVersion"
          type="hidden"
          value={record.version}
        />
        <div className="profile-field-grid company-scope-field-grid">
          <Field
            error={FieldError({ state, name: "recordKey" })}
            htmlFor={keyId}
            label="Demonstration key"
          >
            <Input
              defaultValue={record.recordKey}
              id={keyId}
              maxLength={64}
              name="recordKey"
              required
            />
          </Field>
          <Field
            error={FieldError({ state, name: "title" })}
            htmlFor={titleId}
            label="Title"
          >
            <Input
              defaultValue={record.title}
              id={titleId}
              maxLength={80}
              name="title"
              required
            />
          </Field>
          <Field
            className="profile-field-wide"
            error={FieldError({ state, name: "note" })}
            htmlFor={noteId}
            label="Note"
            optional
          >
            <Textarea
              defaultValue={record.note}
              id={noteId}
              maxLength={500}
              name="note"
              rows={4}
            />
          </Field>
        </div>
        <ActionFeedback state={state} />
        <div className="profile-form-actions">
          <SubmitButton
            idleLabel="Save demonstration record"
            pendingLabel="Saving…"
            variant="secondary"
          />
          <ConfirmDialog
            action={deleteAction}
            confirmLabel="Delete demonstration record"
            danger
            description="This removes only this neutral M1.04 demonstration record from the current Company tenant. It does not delete a real Company, Worker or compliance record."
            pendingLabel="Deleting…"
            title="Delete this demonstration record?"
            triggerLabel="Delete"
          />
        </div>
      </form>
    </article>
  );
}

export function TenantScopeDemonstration({
  tenantReference,
  membershipRole,
  records,
  deleteResult
}: {
  tenantReference: string;
  membershipRole: string;
  records: readonly CompanyScopeDemoViewRecord[];
  deleteResult?: "deleted" | "unchanged";
}): React.JSX.Element {
  return (
    <>
      <section
        className="metric-grid company-scope-context-grid"
        aria-label="Current Company tenant context"
      >
        <article className="metric-card company-scope-context-card">
          <strong>Tenant reference</strong>
          <p className="company-scope-context-value">{tenantReference}</p>
        </article>
        <article className="metric-card company-scope-context-card">
          <strong>Membership role</strong>
          <p className="company-scope-context-value">{membershipRole}</p>
        </article>
        <article className="metric-card company-scope-context-card">
          <strong>Visible records</strong>
          <p className="company-scope-context-value">{records.length}</p>
        </article>
      </section>

      <Alert tone="warning">
        <strong>Demonstration boundary:</strong> use synthetic text only. This surface proves current-tenant authorization and does not represent Company settings, workers, sites, departments, evidence or production data.
      </Alert>

      {deleteResult === "deleted" ? (
        <Alert tone="success">The demonstration record was deleted from the current Company tenant.</Alert>
      ) : null}
      {deleteResult === "unchanged" ? (
        <Alert tone="neutral">
          No record was changed. Missing and cross-tenant identifiers intentionally produce the same non-enumerating result.
        </Alert>
      ) : null}

      <section
        className="dashboard-section company-scope-create-card"
        aria-labelledby="company-scope-create-heading"
      >
        <p className="section-kicker">Protected write demonstration</p>
        <h2 id="company-scope-create-heading">Create a tenant-owned record</h2>
        <p className="page-intro">
          The form sends only the record key and content. Tenant, membership, role and permission context are resolved again on the server.
        </p>
        <CreateDemonstrationRecord />
      </section>

      <section aria-labelledby="company-scope-records-heading">
        <div className="page-heading-row">
          <div>
            <p className="section-kicker">Protected read demonstration</p>
            <h2 id="company-scope-records-heading">Current tenant records</h2>
          </div>
        </div>
        {records.length === 0 ? (
          <EmptyState
            description="Create a synthetic record above. Records owned by any other Company tenant are never listed here."
            title="No demonstration records in this tenant"
          />
        ) : (
          <div className="dashboard-stack">
            {records.map((record) => (
              <RecordEditor key={record.fixtureId} record={record} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
