import Link from "next/link";

import { LiveInterviewMedia } from "@/components/interview/live-interview-media";
import { StatusBadge } from "@/components/worker/status-badge";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { getDatabaseClient } from "@/lib/database/database";
import { formatDateTime } from "@/lib/format";
import { InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";
import { enterInterviewWaitingRoomAction } from "../actions";

const EARLY_JOIN_MS = 30 * 60 * 1000;
const LATE_JOIN_MS = 4 * 60 * 60 * 1000;

export const metadata = {
  title: "Interview waiting room"
};

export default async function WorkerInterviewPage({
  params
}: {
  params: Promise<{ interviewRequestId: string }>;
}): Promise<React.JSX.Element> {
  const session = await requireWorkerSession();
  const { interviewRequestId } = await params;
  const database = await getDatabaseClient();
  const service = new InterviewSchedulingService(database);
  const request = await service.getWorkerInterview({
    workerAccountId: session.sub,
    interviewRequestId
  });

  const clock = await database.query<{ now: string | Date }>("SELECT NOW() AS now");
  const scheduledAt = request.scheduledAt ? Date.parse(request.scheduledAt) : Number.NaN;
  const now = Date.parse(
    clock.rows[0]?.now instanceof Date
      ? clock.rows[0].now.toISOString()
      : String(clock.rows[0]?.now ?? "")
  );
  const joinWindowOpen =
    request.status === "WAITING_ROOM" ||
    (request.status === "ASSIGNED" &&
      Number.isFinite(scheduledAt) &&
      now >= scheduledAt - EARLY_JOIN_MS &&
      now <= scheduledAt + LATE_JOIN_MS);

  const mediaEnabled = request.status === "WAITING_ROOM";

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Interview waiting room</p>
          <h1>Structured competency interview</h1>
          <p className="page-intro">
            Check your camera and microphone, confirm consent and join the assigned
            Assessor through the built-in encrypted interview connection.
          </p>
        </div>
        <StatusBadge
          label={request.status.replaceAll("_", " ").toLowerCase()}
          tone={request.status === "WAITING_ROOM" ? "positive" : "warning"}
        />
      </header>

      <section className="dashboard-section" aria-labelledby="schedule-heading">
        <h2 id="schedule-heading">Interview details</h2>
        <dl className="compact-definition-list">
          <div>
            <dt>Case</dt>
            <dd>{request.caseId}</dd>
          </div>
          <div>
            <dt>Scheduled</dt>
            <dd>{request.scheduledAt ? formatDateTime(request.scheduledAt) : "Awaiting schedule"}</dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd>{request.timezone}</dd>
          </div>
        </dl>

        {request.status === "ASSIGNED" && joinWindowOpen ? (
          <form action={enterInterviewWaitingRoomAction}>
            <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
            <button type="submit" className="button button-primary">
              I&apos;m ready — enter waiting room
            </button>
          </form>
        ) : null}

        {request.status === "ASSIGNED" && !joinWindowOpen ? (
          <p className="muted-copy">
            The waiting room opens 30 minutes before the scheduled time and remains
            available for recovery after the start time.
          </p>
        ) : null}
      </section>

      <section className="dashboard-section" aria-labelledby="media-heading">
        <h2 id="media-heading">Camera, microphone and live interview</h2>
        <LiveInterviewMedia
          interviewRequestId={request.interviewRequestId}
          role="worker"
          enabled={mediaEnabled}
        />
      </section>

      <div className="form-actions">
        <Link className="button button-secondary" href="/worker/dashboard">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}