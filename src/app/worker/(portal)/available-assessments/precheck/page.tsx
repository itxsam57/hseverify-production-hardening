import { notFound } from "next/navigation";

import { AssessmentPrecheckWorkspace } from "@/components/worker/assessment-precheck-workspace";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  AssessmentPrecheckError,
  getAssessmentPrecheckService
} from "@/lib/assessment-attempt/assessment-precheck-service";

export const dynamic = "force-dynamic";

export default async function AssessmentPrecheckPage({
  searchParams
}: {
  searchParams: Promise<{ caseId?: string; catalogueVersionId?: string; error?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const caseId = params.caseId?.trim() ?? "";
  const catalogueVersionId = params.catalogueVersionId?.trim() ?? "";
  const principal = await requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });

  let requirements;
  try {
    requirements = await getAssessmentPrecheckService().requirements(
      principal,
      caseId,
      catalogueVersionId
    );
  } catch (error) {
    if (error instanceof AssessmentPrecheckError) notFound();
    throw error;
  }

  return (
    <section className="page-stack" aria-labelledby="assessment-precheck-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Assessment readiness</p>
          <h1 id="assessment-precheck-heading">Pre-assessment checks</h1>
          <p>Complete only the checks required by this immutable assessment blueprint version.</p>
        </div>
      </div>
      {params.error ? <p className="status-banner status-error" role="alert">{params.error}</p> : null}
      <AssessmentPrecheckWorkspace
        caseId={requirements.caseId}
        catalogueVersionId={requirements.catalogueVersionId}
        title={requirements.title}
        delivery={requirements.delivery}
      />
    </section>
  );
}
