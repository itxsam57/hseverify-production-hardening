import { LoadingState } from "@/components/ui/feedback";

export default function CompanyTenantScopeLoading(): React.JSX.Element {
  return (
    <div className="dashboard-page" aria-busy="true">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Company Portal · M1.04 security demonstration</p>
          <h1>Loading current Company tenant boundary</h1>
        </div>
      </header>
      <LoadingState label="Loading tenant-scoped demonstration records" height="18rem" />
    </div>
  );
}
