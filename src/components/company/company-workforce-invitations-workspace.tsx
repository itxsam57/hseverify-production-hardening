"use client";

import { useActionState } from "react";
import {
  bulkInviteWorkersAction,
  createCompanyRegistrationCodeAction,
  inviteWorkerAction,
  requestPermanentWorkerLinkAction,
  resendWorkerInvitationAction,
  revokeCompanyRegistrationCodeAction,
  revokeWorkerInvitationAction
} from "@/app/company/(portal)/invitations/actions";
import { INITIAL_COMPANY_WORKFORCE_ACTION_STATE } from "@/lib/company/company-workforce-action-state";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { CompanyUnitRecord } from "@/lib/company/company-organization-domain";
import type {
  CompanyRegistrationCodeView,
  CompanyWorkerInvitationView,
  CompanyWorkerLinkView,
  CompanyWorkforceOverview
} from "@/lib/company/company-workforce-view-model";

function Feedback({
  state
}: {
  state: typeof INITIAL_COMPANY_WORKFORCE_ACTION_STATE;
}): React.JSX.Element | null {
  if (!state.message) return null;
  return (
    <div className="content-stack">
      <Alert
        tone={
          state.status === "success"
            ? "success"
            : state.status === "conflict"
              ? "warning"
              : "danger"
        }
      >
        {state.message}
      </Alert>
      {state.invitationPath ? (
        <div className="panel page-section">
          <p className="eyebrow">New invitation link</p>
          <p className="muted-copy">
            Share this only with the intended Worker. A resend invalidates the previous link.
          </p>
          <p><a href={state.invitationPath}>{state.invitationPath}</a></p>
        </div>
      ) : null}
      {state.registrationCode ? (
        <div className="panel page-section">
          <p className="eyebrow">Company registration code</p>
          <p className="muted-copy">
            Copy this code now. HSE Verify stores only its cryptographic hash and cannot reveal it again.
          </p>
          <p><strong>{state.registrationCode}</strong></p>
        </div>
      ) : null}
      {state.bulkResults.length ? (
        <div className="table-scroll" tabIndex={0} aria-label="Bulk invitation results">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Email</th>
                <th>Status</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {state.bulkResults.map((result) => (
                <tr key={`${result.rowNumber}-${result.email}`}>
                  <td>{result.rowNumber}</td>
                  <td>{result.email}</td>
                  <td>{result.status}</td>
                  <td>
                    {result.invitationPath ? (
                      <a href={result.invitationPath}>Invitation link</a>
                    ) : (
                      result.message ?? "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function DefaultsFields({
  prefix,
  sites,
  departments
}: {
  prefix: string;
  sites: readonly CompanyUnitRecord[];
  departments: readonly CompanyUnitRecord[];
}): React.JSX.Element {
  const activeSites = sites.filter((site) => site.status === "active");
  const activeDepartments = departments.filter((department) => department.status === "active");
  return (
    <div className="form-grid">
      <Field htmlFor={`${prefix}-site`} label="Site default" optional>
        <Select id={`${prefix}-site`} name="siteId" defaultValue="">
          <option value="">No Site default</option>
          {activeSites.map((site) => (
            <option key={site.unitId} value={site.unitId}>{site.name}</option>
          ))}
        </Select>
      </Field>
      <Field htmlFor={`${prefix}-department`} label="Department default" optional>
        <Select id={`${prefix}-department`} name="departmentId" defaultValue="">
          <option value="">No Department default</option>
          {activeDepartments.map((department) => (
            <option key={department.unitId} value={department.unitId}>{department.name}</option>
          ))}
        </Select>
      </Field>
      <Field htmlFor={`${prefix}-payment`} label="Future assessment payment default">
        <Select id={`${prefix}-payment`} name="paymentResponsibility" defaultValue="worker">
          <option value="worker">Worker pays</option>
          <option value="company">Company pays</option>
        </Select>
      </Field>
      <Field
        htmlFor={`${prefix}-assessment-reference`}
        label="Future assessment reference"
        optional
        hint="Stored as bounded metadata only. It does not create or assign an assessment in M1.10."
      >
        <Input
          id={`${prefix}-assessment-reference`}
          name="assessmentReference"
          maxLength={120}
          autoComplete="off"
        />
      </Field>
    </div>
  );
}

function SingleInvitationForm({
  sites,
  departments
}: {
  sites: readonly CompanyUnitRecord[];
  departments: readonly CompanyUnitRecord[];
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    inviteWorkerAction,
    INITIAL_COMPANY_WORKFORCE_ACTION_STATE
  );
  return (
    <section className="panel page-section">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Single Worker</p>
          <h2>Invite one Worker</h2>
          <p className="muted-copy">
            The invitation is bound to the normalized email address and expires automatically.
          </p>
        </div>
      </div>
      <Feedback state={state} />
      <form action={action} className="profile-form" noValidate>
        <Field htmlFor="single-worker-email" label="Worker email">
          <Input
            id="single-worker-email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </Field>
        <DefaultsFields prefix="single-worker" sites={sites} departments={departments} />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating invitation…" : "Create Worker invitation"}
        </Button>
      </form>
    </section>
  );
}

function BulkInvitationForm({
  sites,
  departments
}: {
  sites: readonly CompanyUnitRecord[];
  departments: readonly CompanyUnitRecord[];
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    bulkInviteWorkersAction,
    INITIAL_COMPANY_WORKFORCE_ACTION_STATE
  );
  return (
    <section className="panel page-section">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Bulk / CSV</p>
          <h2>Invite multiple Workers</h2>
          <p className="muted-copy">
            Add one email per line, or a CSV whose first column is email. Every submitted row gets an explicit result.
          </p>
        </div>
      </div>
      <Feedback state={state} />
      <form action={action} className="profile-form" noValidate>
        <Field
          htmlFor="bulk-worker-csv"
          label="Worker CSV"
          hint="Up to 500 Worker rows. A header named email is optional."
        >
          <Textarea
            id="bulk-worker-csv"
            name="csv"
            rows={8}
            placeholder={"email\nworker.one@example.com\nworker.two@example.com"}
            required
          />
        </Field>
        <DefaultsFields prefix="bulk-worker" sites={sites} departments={departments} />
        <Button type="submit" disabled={pending}>
          {pending ? "Processing CSV…" : "Process bulk Worker invitations"}
        </Button>
      </form>
    </section>
  );
}

function RegistrationCodeForm({
  sites,
  departments
}: {
  sites: readonly CompanyUnitRecord[];
  departments: readonly CompanyUnitRecord[];
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    createCompanyRegistrationCodeAction,
    INITIAL_COMPANY_WORKFORCE_ACTION_STATE
  );
  return (
    <section className="panel page-section">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Company code</p>
          <h2>Create registration code</h2>
          <p className="muted-copy">
            Codes have explicit expiry and usage limits. Workers still keep ownership of their HSE Verify identity.
          </p>
        </div>
      </div>
      <Feedback state={state} />
      <form action={action} className="profile-form" noValidate>
        <div className="form-grid">
          <Field htmlFor="company-code-usage" label="Usage limit">
            <Input id="company-code-usage" name="usageLimit" type="number" min={1} max={10000} defaultValue={1} required />
          </Field>
          <Field
            htmlFor="company-code-expiry"
            label="Expiry"
            hint="Choose a future date/time within 90 days."
          >
            <Input id="company-code-expiry" name="expiresAt" type="datetime-local" required />
          </Field>
        </div>
        <DefaultsFields prefix="company-code" sites={sites} departments={departments} />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating code…" : "Create Company registration code"}
        </Button>
      </form>
    </section>
  );
}

function PermanentWorkerLinkForm({
  sites,
  departments
}: {
  sites: readonly CompanyUnitRecord[];
  departments: readonly CompanyUnitRecord[];
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    requestPermanentWorkerLinkAction,
    INITIAL_COMPANY_WORKFORCE_ACTION_STATE
  );
  return (
    <section className="panel page-section">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Existing Worker</p>
          <h2>Request link by permanent Worker-ID</h2>
          <p className="muted-copy">
            The permanent Worker-ID and email must belong to the same active Worker. The Worker must consent before the link becomes active.
          </p>
        </div>
      </div>
      <Feedback state={state} />
      <form action={action} className="profile-form" noValidate>
        <div className="form-grid">
          <Field htmlFor="permanent-worker-id" label="Permanent Worker-ID">
            <Input id="permanent-worker-id" name="permanentWorkerId" autoComplete="off" required />
          </Field>
          <Field htmlFor="permanent-worker-email" label="Worker email">
            <Input id="permanent-worker-email" name="email" type="email" autoComplete="email" required />
          </Field>
        </div>
        <DefaultsFields prefix="permanent-worker" sites={sites} departments={departments} />
        <Button type="submit" disabled={pending}>
          {pending ? "Requesting link…" : "Request Worker link"}
        </Button>
      </form>
    </section>
  );
}

function InvitationCard({ invitation }: { invitation: CompanyWorkerInvitationView }): React.JSX.Element {
  const [resendState, resendAction, resendPending] = useActionState(
    resendWorkerInvitationAction,
    INITIAL_COMPANY_WORKFORCE_ACTION_STATE
  );
  const [revokeState, revokeAction] = useActionState(
    revokeWorkerInvitationAction,
    INITIAL_COMPANY_WORKFORCE_ACTION_STATE
  );
  const pending = invitation.status === "pending";
  return (
    <article className="panel page-section">
      <div className="section-heading-row">
        <div>
          <h3>{invitation.email}</h3>
          <p className="muted-copy">
            {invitation.siteName ?? "All Sites"} · {invitation.departmentName ?? "All Departments"} · {invitation.paymentResponsibility === "company" ? "Company pays" : "Worker pays"}
          </p>
        </div>
        <span className="status-pill">{invitation.status}</span>
      </div>
      <p className="muted-copy">
        Created {new Date(invitation.createdAt).toLocaleString()} · expires {new Date(invitation.expiresAt).toLocaleString()} · resends {invitation.resendCount}
      </p>
      {invitation.assessmentReference ? <p>Future assessment reference: {invitation.assessmentReference}</p> : null}
      <Feedback state={resendState} />
      <Feedback state={revokeState} />
      {pending ? (
        <div className="button-row">
          <form action={resendAction}>
            <input type="hidden" name="invitationId" value={invitation.invitationId} />
            <Button type="submit" variant="secondary" disabled={resendPending}>
              {resendPending ? "Resending…" : "Resend with new link"}
            </Button>
          </form>
          <ConfirmDialog
            action={revokeAction}
            confirmLabel="Revoke invitation"
            danger
            description="This invitation will stop working immediately. Its historical record will remain in HSE Verify."
            hiddenFields={[{ name: "invitationId", value: invitation.invitationId }]}
            pendingLabel="Revoking…"
            title={`Revoke invitation for ${invitation.email}?`}
            triggerLabel="Revoke"
          />
        </div>
      ) : null}
    </article>
  );
}

function CodeCard({ code }: { code: CompanyRegistrationCodeView }): React.JSX.Element {
  const [state, action] = useActionState(
    revokeCompanyRegistrationCodeAction,
    INITIAL_COMPANY_WORKFORCE_ACTION_STATE
  );
  return (
    <article className="panel page-section">
      <div className="section-heading-row">
        <div>
          <h3>{code.codeId}</h3>
          <p className="muted-copy">
            {code.siteName ?? "All Sites"} · {code.departmentName ?? "All Departments"} · {code.paymentResponsibility === "company" ? "Company pays" : "Worker pays"}
          </p>
        </div>
        <span className="status-pill">{code.status}</span>
      </div>
      <p>
        <strong>{code.usageCount}</strong> of <strong>{code.usageLimit}</strong> uses consumed
      </p>
      <p className="muted-copy">Expires {new Date(code.expiresAt).toLocaleString()}</p>
      {code.assessmentReference ? <p>Future assessment reference: {code.assessmentReference}</p> : null}
      <Feedback state={state} />
      {code.status === "active" ? (
        <ConfirmDialog
          action={action}
          confirmLabel="Revoke Company code"
          danger
          description="Unused capacity on this Company registration code will stop working immediately. Existing Worker links remain historical records."
          hiddenFields={[{ name: "codeId", value: code.codeId }]}
          pendingLabel="Revoking…"
          title="Revoke this Company registration code?"
          triggerLabel="Revoke code"
        />
      ) : null}
    </article>
  );
}

function LinkCard({ link }: { link: CompanyWorkerLinkView }): React.JSX.Element {
  return (
    <article className="panel page-section">
      <div className="section-heading-row">
        <div>
          <h3>{link.workerEmail}</h3>
          <p className="muted-copy">
            {link.siteName ?? "All Sites"} · {link.departmentName ?? "All Departments"} · {link.paymentResponsibility === "company" ? "Company pays" : "Worker pays"}
          </p>
        </div>
        <span className="status-pill">{link.status}</span>
      </div>
      <p>Source: {link.source.replaceAll("_", " ")}</p>
      {link.permanentWorkerId ? <p>Permanent Worker-ID: {link.permanentWorkerId}</p> : null}
      {link.assessmentReference ? <p>Future assessment reference: {link.assessmentReference}</p> : null}
      <p className="muted-copy">
        Created {new Date(link.createdAt).toLocaleString()}
        {link.activatedAt ? ` · active ${new Date(link.activatedAt).toLocaleString()}` : ""}
      </p>
    </article>
  );
}

export function CompanyWorkforceInvitationsWorkspace({
  overview,
  sites,
  departments
}: {
  overview: CompanyWorkforceOverview;
  sites: readonly CompanyUnitRecord[];
  departments: readonly CompanyUnitRecord[];
}): React.JSX.Element {
  return (
    <div className="content-stack">
      <div className="responsive-card-grid">
        <SingleInvitationForm sites={sites} departments={departments} />
        <BulkInvitationForm sites={sites} departments={departments} />
        <RegistrationCodeForm sites={sites} departments={departments} />
        <PermanentWorkerLinkForm sites={sites} departments={departments} />
      </div>

      <section className="page-section content-stack" aria-labelledby="worker-invitations-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Invitation history</p>
            <h2 id="worker-invitations-heading">Worker invitations</h2>
          </div>
          <span className="status-pill">{overview.invitations.length}</span>
        </div>
        {overview.invitations.length ? (
          overview.invitations.map((invitation) => <InvitationCard key={invitation.invitationId} invitation={invitation} />)
        ) : (
          <Alert tone="neutral">No Worker invitations have been created for this Company yet.</Alert>
        )}
      </section>

      <section className="page-section content-stack" aria-labelledby="company-codes-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Registration access</p>
            <h2 id="company-codes-heading">Company registration codes</h2>
          </div>
          <span className="status-pill">{overview.codes.length}</span>
        </div>
        {overview.codes.length ? (
          overview.codes.map((code) => <CodeCard key={code.codeId} code={code} />)
        ) : (
          <Alert tone="neutral">No Company registration codes have been created yet.</Alert>
        )}
      </section>

      <section className="page-section content-stack" aria-labelledby="worker-links-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Company ↔ Worker consent</p>
            <h2 id="worker-links-heading">Worker links</h2>
          </div>
          <span className="status-pill">{overview.links.length}</span>
        </div>
        {overview.links.length ? (
          overview.links.map((link) => <LinkCard key={link.linkId} link={link} />)
        ) : (
          <Alert tone="neutral">No Workers are linked to this Company through M1.10 yet.</Alert>
        )}
      </section>
    </div>
  );
}
