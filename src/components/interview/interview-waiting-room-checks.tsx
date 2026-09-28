"use client";

import { useState } from "react";

import { markInterviewReadyAction } from "@/app/worker/(portal)/interviews/actions";

type DeviceChecks = Readonly<{
  camera: boolean;
  microphone: boolean;
  connection: boolean;
  ran: boolean;
  message: string;
}>;

const INITIAL: DeviceChecks = Object.freeze({
  camera: false,
  microphone: false,
  connection: false,
  ran: false,
  message: "Run the waiting-room device check before marking yourself Ready."
});

export function InterviewWaitingRoomChecks({
  interviewRequestId,
  recordingPolicy,
  recordingConsentRequired,
  alreadyReady
}: {
  interviewRequestId: string;
  recordingPolicy: "VIDEO_AUDIO" | "AUDIO_ONLY" | "NOTES_ONLY" | "PROHIBITED";
  recordingConsentRequired: boolean;
  alreadyReady: boolean;
}): React.JSX.Element {
  const [checks, setChecks] = useState<DeviceChecks>(INITIAL);
  const [checking, setChecking] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);

  async function runChecks(): Promise<void> {
    setChecking(true);
    let camera = false;
    let microphone = false;
    const connection = navigator.onLine;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setChecks({
          camera: false,
          microphone: false,
          connection,
          ran: true,
          message: "Camera and microphone are unavailable in this browser."
        });
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      camera = stream.getVideoTracks().length > 0;
      microphone = stream.getAudioTracks().length > 0;
      stream.getTracks().forEach((track) => track.stop());
      setChecks({
        camera,
        microphone,
        connection,
        ran: true,
        message:
          camera && microphone && connection
            ? "Camera, microphone and connection checks passed."
            : "One or more waiting-room checks did not pass."
      });
    } catch {
      setChecks({
        camera: false,
        microphone: false,
        connection,
        ran: true,
        message: "Camera or microphone permission did not pass."
      });
    } finally {
      setChecking(false);
    }
  }

  if (alreadyReady) {
    return (
      <p className="status-banner status-success" role="status">
        Ready checks and required consent are recorded. Wait for the assigned Assessor to admit you.
      </p>
    );
  }

  const checksPassed = checks.ran && checks.camera && checks.microphone && checks.connection;
  const consentPassed = !recordingConsentRequired || recordingConsent;

  return (
    <div className="content-stack">
      <div className="button-row">
        <button
          className="button button-secondary"
          type="button"
          disabled={checking}
          onClick={() => void runChecks()}
        >
          {checking ? "Checking…" : "Check camera, microphone & connection"}
        </button>
      </div>
      <p className={checksPassed ? "status-banner status-success" : "status-banner status-warning"} role="status">
        {checks.message}
      </p>
      <form action={markInterviewReadyAction} className="form-grid">
        <input type="hidden" name="interviewRequestId" value={interviewRequestId} />
        <input type="hidden" name="cameraReady" value={checks.camera ? "yes" : "no"} />
        <input type="hidden" name="microphoneReady" value={checks.microphone ? "yes" : "no"} />
        <input type="hidden" name="connectionReady" value={checks.connection ? "yes" : "no"} />
        <label>
          <input
            type="checkbox"
            name="identityConfirmed"
            value="yes"
            required
            checked={identityConfirmed}
            onChange={(event) => setIdentityConfirmed(event.currentTarget.checked)}
          />
          I confirm I am the Worker assigned to this interview.
        </label>
        {recordingConsentRequired ? (
          <label>
            <input
              type="checkbox"
              name="recordingConsent"
              value="yes"
              required
              checked={recordingConsent}
              onChange={(event) => setRecordingConsent(event.currentTarget.checked)}
            />
            I consent to the interview recording required by this case policy (
            {recordingPolicy.replaceAll("_", " ").toLowerCase()}).
          </label>
        ) : (
          <input type="hidden" name="recordingConsent" value="no" />
        )}
        <button
          className="button button-primary"
          type="submit"
          disabled={!checksPassed || !identityConfirmed || !consentPassed}
        >
          Ready for Interview
        </button>
      </form>
    </div>
  );
}
