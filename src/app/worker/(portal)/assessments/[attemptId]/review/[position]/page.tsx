import { notFound } from "next/navigation";

import { AssessmentReviewWorkspace } from "@/components/worker/assessment-review-workspace";
import { readAssessmentAccessContext } from "@/lib/assessment-attempt/assessment-device-cookie";
import {
  AssessmentAttemptAccessError,
  AssessmentAttemptConflictError,
  AssessmentAttemptInputError,
  getAssessmentAttemptService
} from "@/lib/assessment-attempt/assessment-attempt-service";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";

export const dynamic = "force-dynamic";

export default async function AssessmentReviewQuestionPage({
  params,
  searchParams
}: {
  params: Promise<{ attemptId: string; position: string }>;
  searchParams: Promise<{ error?: string }>;
}): Promise<React.JSX.Element> {
  const { attemptId, position: rawPosition } = await params;
  const { error } = await searchParams;
  const position = Number(rawPosition);
  if (!Number.isSafeInteger(position) || position < 1) notFound();

  const principal = await requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });
  const accessContext = await readAssessmentAccessContext();

  try {
    const review = await (await getAssessmentAttemptService()).getReviewQuestion(
      principal,
      attemptId,
      position,
      accessContext
    );
    return <AssessmentReviewWorkspace review={review} routeError={error ?? null} />;
  } catch (caught) {
    if (
      caught instanceof AssessmentAttemptAccessError ||
      caught instanceof AssessmentAttemptConflictError ||
      caught instanceof AssessmentAttemptInputError
    ) {
      notFound();
    }
    throw caught;
  }
}
