"use client";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

export default function CompanyTenantScopeError({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Company Portal · M1.04 security demonstration</p>
          <h1>Tenant demonstration unavailable</h1>
        </div>
      </header>
      <Alert tone="danger">
        The protected demonstration could not be loaded. No tenant or record details were exposed. Retry after confirming the database and session are available.
      </Alert>
      <div>
        <Button onClick={reset} type="button">
          Retry protected load
        </Button>
      </div>
    </div>
  );
}
