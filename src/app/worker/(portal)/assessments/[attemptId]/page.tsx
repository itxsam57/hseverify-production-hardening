import { notFound } from "next/navigation";

import { AssessmentWorkspace } from "@/components/worker/assessment-workspace";
import { toAssessmentAttemptClientView } from "@/lib/assessment-attempt/assessment-attempt-client-view";
import {
  AssessmentAttemptAccessError,
  AssessmentAttemptInputError,
  getAssessmentAttemptService,
  type AssessmentAttemptView
} from "@/lib/assessment-attempt/assessment-attempt-service";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { readAssessmentAccessContext } from "@/lib/assessment-attempt/assessment-device-cookie";

export const dynamic = "force-dynamic";

export default async function AssessmentPage({
  params
}: {
  params: Promise<{ attemptId: string }>;
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });
  const { attemptId } = await params;

  const accessContext = await readAssessmentAccessContext();
  let view: AssessmentAttemptView;
  try {
    view = await (
      await getAssessmentAttemptService()
    ).getOwnedView(principal, attemptId, new Date(), accessContext);
  } catch (error) {
    if (
      error instanceof AssessmentAttemptAccessError ||
      error instanceof AssessmentAttemptInputError
    ) {
      notFound();
    }
    throw error;
  }

  const clientView = toAssessmentAttemptClientView(view);
  return <AssessmentWorkspace view={clientView} />;
}