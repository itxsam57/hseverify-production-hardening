"use client";

import { useMemo, useState } from "react";

import { completeAssessmentPrecheckAction } from "@/app/worker/(portal)/available-assessments/actions";
import type { AssessmentDeliverySettings } from "@/lib/assessment-generation/assessment-delivery-settings";

type CheckState = Readonly<{
  supportedBrowser: boolean;
  connectionOk: boolean;
  cameraOk: boolean;
  microphoneOk: boolean;
  screenShareOk: boolean;
  fullscreenCapable: boolean;
  ran: boolean;
  message: string;
}>;

const INITIAL: CheckState = Object.freeze({
  supportedBrowser: false,
  connectionOk: false,
  cameraOk: false,
  microphoneOk: false,
  screenShareOk: false,
  fullscreenCapable: false,
  ran: false,
  message: "Run device checks before beginning."
});

function bool(value: boolean): string {
  return value ? "yes" : "no";
}

async function stopStream(stream: MediaStream | null): Promise<void> {
  stream?.getTracks().forEach((track) => track.stop());
}

export function AssessmentPrecheckWorkspace({
  caseId,
  catalogueVersionId,
  title,
  delivery,
  accommodation
}: {
  caseId: string;
  catalogueVersionId: string;
  title: string;
  delivery: AssessmentDeliverySettings;
  accommodation: Readonly<{
    timeMultiplier: number;
    extraBreakMinutes: number;
    screenReader: boolean;
    captions: boolean;
    interpreter: boolean;
    reducedMotion: boolean;
  }>;
}): React.JSX.Element {
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<CheckState>(INITIAL);

  const requiredPassed = useMemo(() => {
    if (!checks.ran || !checks.supportedBrowser || !checks.connectionOk) return false;
    if (delivery.requireCamera && !checks.cameraOk) return false;
    if (delivery.requireMicrophone && !checks.microphoneOk) return false;
    if (delivery.requireScreenShare && !checks.screenShareOk) return false;
    if (delivery.requireFullscreen && !checks.fullscreenCapable) return false;
    return true;
  }, [checks, delivery]);

  const runChecks = async (): Promise<void> => {
    setChecking(true);
    let cameraOk = !delivery.requireCamera;
    let microphoneOk = !delivery.requireMicrophone;
    let screenShareOk = !delivery.requireScreenShare;
    let message = "Device checks completed.";

    try {
      const supportedBrowser = Boolean(
        window.isSecureContext &&
        navigator.mediaDevices &&
        typeof window.fetch === "function"
      );
      const connectionOk = navigator.onLine;
      const fullscreenCapable = document.fullscreenEnabled !== false;

      if ((delivery.requireCamera || delivery.requireMicrophone) && navigator.mediaDevices?.getUserMedia) {
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: delivery.requireCamera,
            audio: delivery.requireMicrophone
          });
          cameraOk = !delivery.requireCamera || stream.getVideoTracks().length > 0;
          microphoneOk = !delivery.requireMicrophone || stream.getAudioTracks().length > 0;
        } catch {
          cameraOk = !delivery.requireCamera;
          microphoneOk = !delivery.requireMicrophone;
        } finally {
          await stopStream(stream);
        }
      }

      if (delivery.requireScreenShare) {
        let stream: MediaStream | null = null;
        try {
          const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
          if (getDisplayMedia) {
            stream = await getDisplayMedia({ video: true, audio: false });
            screenShareOk = stream.getVideoTracks().length > 0;
          } else {
            screenShareOk = false;
          }
        } catch {
          screenShareOk = false;
        } finally {
          await stopStream(stream);
        }
      }

      if (!supportedBrowser) message = "This browser does not expose the required secure assessment capabilities.";
      else if (!connectionOk) message = "Network connection is currently unavailable.";
      else if (delivery.requireCamera && !cameraOk) message = "Camera permission/check did not pass.";
      else if (delivery.requireMicrophone && !microphoneOk) message = "Microphone permission/check did not pass.";
      else if (delivery.requireScreenShare && !screenShareOk) message = "Screen-share permission/check did not pass.";
      else if (delivery.requireFullscreen && !fullscreenCapable) message = "Fullscreen capability is unavailable.";

      setChecks(Object.freeze({
        supportedBrowser,
        connectionOk,
        cameraOk,
        microphoneOk,
        screenShareOk,
        fullscreenCapable,
        ran: true,
        message
      }));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="content-stack">
      <section className="panel page-section">
        <p className="eyebrow">Pre-assessment checks</p>
        <h1>{title}</h1>
        <p>
          HSE Verify requests camera, microphone or screen sharing only after you press
          <strong> Run device checks</strong>, and only when this assessment requires them.
        </p>
        <dl>
          <div><dt>Progression mode</dt><dd>{delivery.progressionMode.replaceAll("_", " ")}</dd></div>
          <div><dt>Camera</dt><dd>{delivery.requireCamera ? "Required" : "Not required"}</dd></div>
          <div><dt>Microphone</dt><dd>{delivery.requireMicrophone ? "Required" : "Not required"}</dd></div>
          <div><dt>Screen share</dt><dd>{delivery.requireScreenShare ? "Required" : "Not required"}</dd></div>
          <div><dt>Fullscreen capability</dt><dd>{delivery.requireFullscreen ? "Required" : "Not required"}</dd></div>
        </dl>
        <section className="content-stack" aria-label="Approved delivery accommodations">
          <h2>Approved delivery adjustments</h2>
          <dl>
            <div><dt>Time allowance</dt><dd>{accommodation.timeMultiplier}×</dd></div>
            <div><dt>Extra break allowance</dt><dd>{accommodation.extraBreakMinutes} minutes</dd></div>
            <div><dt>Screen reader</dt><dd>{accommodation.screenReader ? "Approved" : "Standard delivery"}</dd></div>
            <div><dt>Captions</dt><dd>{accommodation.captions ? "Approved" : "Standard delivery"}</dd></div>
            <div><dt>Interpreter</dt><dd>{accommodation.interpreter ? "Approved" : "Standard delivery"}</dd></div>
            <div><dt>Reduced motion</dt><dd>{accommodation.reducedMotion ? "Approved" : "Standard delivery"}</dd></div>
          </dl>
          <p className="muted-copy">These adjustments change delivery conditions only. They do not change competency standards or pass requirements.</p>
        </section>
        <button className="button button-secondary" type="button" disabled={checking} onClick={() => void runChecks()}>
          {checking ? "Checking…" : "Run device checks"}
        </button>
        <p className={requiredPassed ? "status-banner status-success" : "status-banner status-warning"} role="status">
          {checks.message}
        </p>
      </section>

      <form action={completeAssessmentPrecheckAction} className="panel page-section content-stack">
        <input type="hidden" name="caseId" value={caseId} />
        <input type="hidden" name="catalogueVersionId" value={catalogueVersionId} />
        <input type="hidden" name="supportedBrowser" value={bool(checks.supportedBrowser)} />
        <input type="hidden" name="connectionOk" value={bool(checks.connectionOk)} />
        <input type="hidden" name="cameraOk" value={bool(checks.cameraOk)} />
        <input type="hidden" name="microphoneOk" value={bool(checks.microphoneOk)} />
        <input type="hidden" name="screenShareOk" value={bool(checks.screenShareOk)} />
        <input type="hidden" name="fullscreenCapable" value={bool(checks.fullscreenCapable)} />
        <input type="hidden" name="clientDiagnostic" value={typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 240)} />

        <label>
          <input name="identityReconfirmed" type="checkbox" value="yes" required />
          I confirm I am the Worker assigned to this assessment.
        </label>
        {delivery.requireEnvironmentDeclaration ? (
          <label>
            <input name="environmentDeclared" type="checkbox" value="yes" required />
            I confirm my environment is suitable and I will follow the displayed assessment rules.
          </label>
        ) : <input type="hidden" name="environmentDeclared" value="yes" />}
        {delivery.requireMonitoringConsent ? (
          <label>
            <input name="monitoringConsented" type="checkbox" value="yes" required />
            I consent to the monitoring signals required by this assessment and understand they are review evidence, not an automatic accusation.
          </label>
        ) : <input type="hidden" name="monitoringConsented" value="yes" />}

        <p className="muted-copy">
          Beginning binds the assessment to this authorized browser/device context. Another device cannot silently take over the attempt.
        </p>
        <button className="button button-primary" type="submit" disabled={!requiredPassed}>
          Begin assessment
        </button>
      </form>
    </section>
  );
}
