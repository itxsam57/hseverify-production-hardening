import Link from "next/link";
import { notFound } from "next/navigation";

import { InterviewWaitingRoomChecks } from "@/components/interview/interview-waiting-room-checks";
import { LiveInterviewMedia } from "@/components/interview/live-interview-media";
import { StatusBadge } from "@/components/worker/status-badge";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { formatDateTime } from "@/lib/format";
import { InterviewRuntimeService } from "@/lib/interview/interview-runtime-service";
import { InterviewWorkerAccessError, InterviewSchedulingService } from "@/lib/interview/interview-scheduling-service";
import { CaseAccommodationService } from "@/lib/privacy/case-accommodation-service";
import {
  enterInterviewWaitingRoomAction,
  saveInterviewAvailabilityAction,
  reportWorkerInterviewTechnicalIssueAction
} from "../actions";

const EARLY_JOIN_MS = 30 * 60 * 1000;
const LATE_JOIN_MS = 4 * 60 * 60 * 1000;

export const metadata = {
  title: "Interview waiting room"
};

export default async function WorkerInterviewPage({
  params,searchParams
}: {
  params: Promise<{ interviewRequestId: string }>;
  searchParams:Promise<{availabilityError?:string;availabilitySaved?:string;technicalError?:string;technicalSaved?:string}>;
}): Promise<React.JSX.Element> {
  const principal = await requirePortalAuthorization("worker");
  const messages=await searchParams;
  const { interviewRequestId } = await params;
  const database = await getDatabaseClient();
  const service = new InterviewSchedulingService(database);
  const request = await service.getWorkerInterview({
    workerAccountId: principal.accountId,
    interviewRequestId
  }).catch((error: unknown) => {
    if (error instanceof InterviewWorkerAccessError) notFound();
    throw error;
  });
  const [runtime, accommodation] = await Promise.all([
    new InterviewRuntimeService(Promise.resolve(database)).view(principal, interviewRequestId),
    new CaseAccommodationService(Promise.resolve(database)).resolveForWorker(
      request.caseId,
      principal.accountId
    )
  ]);

  const clock = await database.query<{ now: string | Date }>("SELECT NOW() AS now");
  const scheduledAt = request.scheduledAt ? Date.parse(request.scheduledAt) : Number.NaN;
  const now = Date.parse(
    clock.rows[0]?.now instanceof Date
      ? clock.rows[0].now.toISOString()
      : String(clock.rows[0]?.now ?? "")
  );
  const scheduledWindowOpen =
    Number.isFinite(scheduledAt) &&
    now >= scheduledAt - EARLY_JOIN_MS &&
    now <= scheduledAt + LATE_JOIN_MS;
  const joinWindowOpen =
    request.status === "WAITING_ROOM" ||
    (request.status === "ASSIGNED" && scheduledWindowOpen);
  const technicalReportAllowed =
    !["ENDED", "NO_SHOW"].includes(runtime.status ?? "") &&
    (Boolean(runtime.interviewSessionId) ||
      (["ASSIGNED", "WAITING_ROOM"].includes(request.status) && scheduledWindowOpen));

  const inWaitingRoom = request.status === "WAITING_ROOM";
  const mediaEnabled =
    runtime.status === "ADMITTED" ||
    runtime.status === "ACTIVE" ||
    runtime.status === "PAUSED" ||
    runtime.status === "TECHNICAL_HOLD";
  const ready = runtime.status === "READY" || Boolean(runtime.workerReadyAt);

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Interview waiting room</p>
          <h1>Structured competency interview</h1>
          <p className="page-intro">
            Complete the readiness checks, recording consent when required, then wait for
            the assigned Assessor to admit you into the built-in encrypted interview.
          </p>
        </div>
        <StatusBadge
          label={(runtime.status ?? request.status).replaceAll("_", " ").toLowerCase()}
          tone={ready || mediaEnabled ? "positive" : "warning"}
        />
      </header>

      {messages.technicalError === "invalid" ? (
        <p role="alert">Check the technical issue (5 to 2000 characters). Initial reports require the scheduled join window; closed interviews cannot accept a report.</p>
      ) : null}
      {messages.technicalSaved === "yes" ? <p role="status">Technical issue recorded.</p> : null}

      <section className="dashboard-section" aria-labelledby="availability-heading">
        <h2 id="availability-heading">Interview availability (UTC)</h2>
        <p>Choose a time window when you can attend. The Assessor chooses an appointment within it.</p>
        {messages.availabilityError==="invalid" ? <p role="alert">Enter a valid future availability window ending after it starts. Claimed or closed interviews cannot change availability.</p> : null}
        {messages.availabilitySaved==="yes" ? <p role="status">Interview availability saved.</p> : null}
        {request.scheduledAt ? <p>An appointment is scheduled. Changing availability leaves that appointment intact; contact the Assessor if it needs to move.</p> : null}
        {["REQUESTED","ASSIGNED"].includes(request.status) && !runtime.status ? (
          <form action={saveInterviewAvailabilityAction}>
            <input type="hidden" name="interviewRequestId" value={interviewRequestId} />
            <label>Available from (UTC)<input type="datetime-local" name="availableFrom" required defaultValue={request.workerAvailability?.availableFrom.slice(0,16) ?? ""} /></label>
            <label>Available until (UTC)<input type="datetime-local" name="availableUntil" required defaultValue={request.workerAvailability?.availableUntil.slice(0,16) ?? ""} /></label>
            <button type="submit" className="button button-secondary">Save interview availability</button>
          </form>
        ) : <p>Availability changes are closed for this interview.</p>}
      </section>

      <section className="dashboard-section" aria-labelledby="schedule-heading">
        <h2 id="schedule-heading">Interview details</h2>
        <dl className="compact-definition-list">
          <div><dt>Case</dt><dd>{request.caseId}</dd></div>
          <div><dt>Scheduled</dt><dd>{request.scheduledAt ? formatDateTime(request.scheduledAt) : "Awaiting schedule"}</dd></div>
          <div><dt>Timezone</dt><dd>{request.timezone}</dd></div>
          <div><dt>Recording policy</dt><dd>{runtime.recordingPolicy.replaceAll("_", " ").toLowerCase()}</dd></div>
          <div><dt>Runtime state</dt><dd>{runtime.status?.replaceAll("_", " ").toLowerCase() ?? "Not opened"}</dd></div>
          <div><dt>Approved time allowance</dt><dd>{accommodation.adjustment.timeMultiplier}×</dd></div>
          <div><dt>Extra break allowance</dt><dd>{accommodation.adjustment.extraBreakMinutes} minutes</dd></div>
          <div><dt>Captions</dt><dd>{accommodation.adjustment.captions ? "Approved" : "Standard delivery"}</dd></div>
          <div><dt>Interpreter</dt><dd>{accommodation.adjustment.interpreter ? "Approved" : "Standard delivery"}</dd></div>
        </dl>

        {request.status === "ASSIGNED" && joinWindowOpen ? (
          <form action={enterInterviewWaitingRoomAction}>
            <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
            <button type="submit" className="button button-primary">
              Enter waiting room
            </button>
          </form>
        ) : null}

        {request.status === "ASSIGNED" && !joinWindowOpen ? (
          <p className="muted-copy">
            The waiting room opens 30 minutes before the scheduled time and remains
            available for controlled recovery after the start time.
          </p>
        ) : null}
      </section>

      {inWaitingRoom ? (
        <section className="dashboard-section" aria-labelledby="ready-heading">
          <h2 id="ready-heading">Readiness checks</h2>
          <InterviewWaitingRoomChecks
            interviewRequestId={request.interviewRequestId}
            recordingPolicy={runtime.recordingPolicy}
            recordingConsentRequired={runtime.recordingConsentRequired}
            alreadyReady={ready}
          />
        </section>
      ) : null}

      <section className="dashboard-section" aria-labelledby="media-heading">
        <h2 id="media-heading">Camera, microphone and live interview</h2>
        <LiveInterviewMedia
          interviewRequestId={request.interviewRequestId}
          role="worker"
          enabled={mediaEnabled}
          recordingPolicy={runtime.recordingPolicy}
          recordingEnabled={runtime.status === "ACTIVE"}
          recordingRetentionDays={runtime.recordingRetentionDays}
        />
        {!mediaEnabled && ready ? (
          <p className="muted-copy">You are Ready. The Assessor must admit you before live media opens.</p>
        ) : null}
      </section>

      {technicalReportAllowed ? (
        <section className="dashboard-section" aria-labelledby="technical-heading">
          <h2 id="technical-heading">Technical issue</h2>
          <form action={reportWorkerInterviewTechnicalIssueAction} className="form-grid">
            <input type="hidden" name="interviewRequestId" value={request.interviewRequestId} />
            <label>
              Describe the issue
              <textarea name="issue" rows={3} minLength={5} maxLength={2000} required />
            </label>
            <button className="button button-secondary" type="submit">Record technical issue</button>
          </form>
        </section>
      ) : null}

      <div className="form-actions">
        <Link className="button button-secondary" href="/worker/dashboard">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
