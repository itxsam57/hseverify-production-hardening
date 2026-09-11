"use client";

import { useActionState } from "react";

import {
  acceptCompanyWorkerLinkAction,
  redeemCompanyRegistrationCodeAction
} from "@/app/worker/(portal)/company-access/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { INITIAL_WORKER_COMPANY_ACCESS_ACTION_STATE } from "@/lib/company/company-workforce-action-state";
import type { WorkerCompanyAccessLink } from "@/lib/company/company-workforce-worker-read-repository";

function Feedback({
  state
}: {
  state: typeof INITIAL_WORKER_COMPANY_ACCESS_ACTION_STATE;
}): React.JSX.Element | null {
  if (!state.message) return null;
  return (
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
  );
}

function CompanyCodeForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(
    redeemCompanyRegistrationCodeAction,
    INITIAL_WORKER_COMPANY_ACCESS_ACTION_STATE
  );
  return (
    <section className="panel page-section content-stack">
      <div>
        <p className="eyebrow">Join with a code</p>
        <h2>Company registration code</h2>
        <p className="muted-copy">
          Enter a current code from a verified Company. HSE Verify re-checks expiry, remaining uses and Company status before linking.
        </p>
      </div>
      <Feedback state={state} />
      <form action={action} className="profile-form" noValidate>
        <Field htmlFor="worker-company-registration-code" label="Registration code">
          <Input
            id="worker-company-registration-code"
            name="registrationCode"
            autoComplete="off"
            maxLength={160}
            required
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Checking code…" : "Join Company with code"}
        </Button>
      </form>
    </section>
  );
}

function LinkCard({ link }: { link: WorkerCompanyAccessLink }): React.JSX.Element {
  const [state, action, pending] = useActionState(
    acceptCompanyWorkerLinkAction,
    INITIAL_WORKER_COMPANY_ACCESS_ACTION_STATE
  );
  return (
    <article className="panel page-section content-stack">
      <div className="section-heading-row">
        <div>
          <h3>{link.companyName}</h3>
          <p className="muted-copy">
            {link.siteName ?? "All Sites"} · {link.departmentName ?? "All Departments"} · {link.paymentResponsibility === "company" ? "Company pays future orders" : "Worker pays future orders"}
          </p>
        </div>
        <span className="status-pill">{link.status.replaceAll("_", " ")}</span>
      </div>
      <p>Link source: {link.source.replaceAll("_", " ")}</p>
      {link.permanentWorkerId ? <p>Permanent Worker-ID: {link.permanentWorkerId}</p> : null}
      {link.assessmentReference ? (
        <p>Future assessment reference: {link.assessmentReference}</p>
      ) : null}
      <p className="muted-copy">
        Created {new Date(link.createdAt).toLocaleString()}
        {link.activatedAt ? ` · active ${new Date(link.activatedAt).toLocaleString()}` : ""}
      </p>
      <Feedback state={state} />
      {link.status === "pending_worker_acceptance" ? (
        <form action={action}>
          <input type="hidden" name="linkId" value={link.linkId} />
          <Button type="submit" disabled={pending}>
            {pending ? "Accepting…" : "Accept Company link"}
          </Button>
        </form>
      ) : null}
    </article>
  );
}

export function WorkerCompanyAccessWorkspace({
  links
}: {
  links: readonly WorkerCompanyAccessLink[];
}): React.JSX.Element {
  const pendingLinks = links.filter((link) => link.status === "pending_worker_acceptance");
  const activeLinks = links.filter((link) => link.status === "active");
  const historicalLinks = links.filter((link) => link.status === "revoked");

  return (
    <div className="content-stack">
      <CompanyCodeForm />

      <section className="page-section content-stack" aria-labelledby="pending-company-links-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Consent required</p>
            <h2 id="pending-company-links-heading">Pending Company links</h2>
          </div>
          <span className="status-pill">{pendingLinks.length}</span>
        </div>
        {pendingLinks.length ? (
          pendingLinks.map((link) => <LinkCard key={link.linkId} link={link} />)
        ) : (
          <Alert tone="neutral">No Company link is waiting for your consent.</Alert>
        )}
      </section>

      <section className="page-section content-stack" aria-labelledby="active-company-links-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Current access</p>
            <h2 id="active-company-links-heading">Active Company links</h2>
          </div>
          <span className="status-pill">{activeLinks.length}</span>
        </div>
        {activeLinks.length ? (
          activeLinks.map((link) => <LinkCard key={link.linkId} link={link} />)
        ) : (
          <Alert tone="neutral">You are not currently linked to a Company through M1.10.</Alert>
        )}
      </section>

      {historicalLinks.length ? (
        <section className="page-section content-stack" aria-labelledby="historical-company-links-heading">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">History retained</p>
              <h2 id="historical-company-links-heading">Previous Company links</h2>
            </div>
            <span className="status-pill">{historicalLinks.length}</span>
          </div>
          {historicalLinks.map((link) => <LinkCard key={link.linkId} link={link} />)}
        </section>
      ) : null}
    </div>
  );
}
