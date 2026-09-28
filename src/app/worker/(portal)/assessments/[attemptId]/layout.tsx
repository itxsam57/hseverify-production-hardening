import type { ReactNode } from "react";

import { AssessmentIntegrityBoundary } from "@/components/worker/assessment-integrity-boundary";

export default async function AssessmentAttemptLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ attemptId: string }>;
}): Promise<React.JSX.Element> {
  const { attemptId } = await params;
  return (
    <AssessmentIntegrityBoundary attemptId={attemptId}>
      {children}
    </AssessmentIntegrityBoundary>
  );
}
