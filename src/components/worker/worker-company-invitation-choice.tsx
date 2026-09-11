"use client";

import { useActionState } from "react";

import {
  acceptWorkerCompanyInvitationAction,
  prepareCompanyWorkforceRegistrationAction,
  prepareCompanyWorkforceSignInAction
} from "@/app/worker/company-invitations/[token]/actions";
import { INITIAL_WORKER_COMPANY_INVITATION_ACTION_STATE } from "@/lib/company/company-workforce-action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

function Feedback({ error }: { error: string | null }): React.JSX.Element | null {
  return error ? <Alert tone="danger">{error}</Alert> : null;
}

function RegistrationChoice({ token }: { token: string }): React.JSX.Element {
  const [state, action, pending] = useActionState(
    prepareCompanyWorkforceRegistrationAction,
    INITIAL_WORKER_COMPANY_INVITATION_ACTION_STATE
  );
  return (
    <div className="panel page-section content-stack">
      <div>
        <p className="eyebrow">New Worker</p>
        <h2>Create Worker account</h2>
        <p className="muted-copy">
          Use the normal HSE Verify registration. Email verification and phone verification remain mandatory before the Company link can activate.
        </p>
      </div>
      <Feedback error={state.error} />
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" disabled={pending}>
          {pending ? "Checking invitation…" : "Create Worker account"}
        </Button>
      </form>
    </div>
  );
}

function SignInChoice({ token }: { token: string }): React.JSX.Element {
  const [state, action, pending] = useActionState(
    prepareCompanyWorkforceSignInAction,
    INITIAL_WORKER_COMPANY_INVITATION_ACTION_STATE
  );
  return (
    <div className="panel page-section content-stack">
      <div>
        <p className="eyebrow">Existing Worker</p>
        <h2>Worker sign-in</h2>
        <p className="muted-copy">
          The invitation is converted to a signed server handoff before sign-in. The invitation secret is not copied into the login URL.
        </p>
      </div>
      <Feedback error={state.error} />
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Checking invitation…" : "Worker sign-in"}
        </Button>
      </form>
    </div>
  );
}

function SignedInWorkerChoice({ token }: { token: string }): React.JSX.Element {
  const [state, action, pending] = useActionState(
    acceptWorkerCompanyInvitationAction,
    INITIAL_WORKER_COMPANY_INVITATION_ACTION_STATE
  );
  return (
    <div className="panel page-section content-stack">
      <div>
        <p className="eyebrow">Worker session active</p>
        <h2>Accept Company invitation</h2>
        <p className="muted-copy">
          HSE Verify will re-check the live Worker account, invitation email, Company verification and invitation status before linking.
        </p>
      </div>
      <Feedback error={state.error} />
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" disabled={pending}>
          {pending ? "Accepting invitation…" : "Accept invitation"}
        </Button>
      </form>
    </div>
  );
}

export function WorkerCompanyInvitationChoice({
  token,
  sessionKind
}: {
  token: string;
  sessionKind: "none" | "worker" | "other";
}): React.JSX.Element {
  if (sessionKind === "worker") return <SignedInWorkerChoice token={token} />;
  if (sessionKind === "other") {
    return (
      <Alert tone="warning">
        Another isolated portal session is active. Return to that portal, sign out completely, then reopen this Worker invitation.
      </Alert>
    );
  }
  return (
    <div className="responsive-card-grid">
      <RegistrationChoice token={token} />
      <SignInChoice token={token} />
    </div>
  );
}
