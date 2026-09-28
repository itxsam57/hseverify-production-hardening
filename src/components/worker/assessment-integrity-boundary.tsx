"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type IntegrityPolicy = Readonly<{
  requireCamera: boolean;
  requireMicrophone: boolean;
  requireScreenShare: boolean;
  recordCamera: boolean;
  recordMicrophone: boolean;
  recordScreen: boolean;
  recordingRetentionDays: number;
  integrityFailureMode: "REVIEW" | "BLOCK";
  requireFullscreen: boolean;
}>;

type BoundaryState = "loading" | "ready" | "needs-start" | "starting" | "degraded" | "blocked";

function requiresLiveMedia(policy: IntegrityPolicy): boolean {
  return (
    policy.requireCamera ||
    policy.requireMicrophone ||
    policy.requireScreenShare ||
    policy.recordCamera ||
    policy.recordMicrophone ||
    policy.recordScreen
  );
}

function segmentKey(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function AssessmentIntegrityBoundary({
  attemptId,
  children
}: {
  attemptId: string;
  children: ReactNode;
}): React.JSX.Element {
  const [policy, setPolicy] = useState<IntegrityPolicy | null>(null);
  const [state, setState] = useState<BoundaryState>("loading");
  const [message, setMessage] = useState("Loading assessment monitoring policy…");
  const mediaStreams = useRef<MediaStream[]>([]);
  const recorders = useRef<MediaRecorder[]>([]);
  const mounted = useRef(true);

  const report = useCallback(async (
    type: string,
    details?: Record<string, string | boolean | number>,
    providerState?: "BUILT_IN" | "EXTERNAL_READY" | "DEGRADED" | "UNAVAILABLE"
  ): Promise<void> => {
    try {
      await fetch(`/api/worker/assessments/${encodeURIComponent(attemptId)}/integrity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          occurredAt: new Date().toISOString(),
          details,
          providerState
        }),
        cache: "no-store"
      });
    } catch {
      // The browser may be offline. The assessment save/recovery path remains authoritative;
      // provider/network degradation is reported when connectivity returns.
    }
  }, [attemptId]);

  const uploadSegment = useCallback(async (
    blob: Blob,
    source: "CAMERA" | "MICROPHONE" | "SCREEN" | "VIDEO_AUDIO" | "AUDIO_ONLY",
    startedAt: string,
    endedAt: string
  ): Promise<void> => {
    if (blob.size < 1) return;
    try {
      const response = await fetch(
        `/api/worker/assessments/${encodeURIComponent(attemptId)}/integrity/media`,
        {
          method: "POST",
          headers: {
            "content-type": blob.type || (source === "AUDIO_ONLY" ? "audio/webm" : "video/webm"),
            "x-recording-source": source,
            "x-recording-segment-key": segmentKey(),
            "x-recording-started-at": startedAt,
            "x-recording-ended-at": endedAt
          },
          body: blob,
          cache: "no-store"
        }
      );
      if (!response.ok) throw new Error("recording upload failed");
    } catch {
      await report(
        "RECORDING_FAILED",
        { source, reason: "segment_upload_failed" },
        "DEGRADED"
      );
      if (mounted.current) {
        setState((current) => policy?.integrityFailureMode === "BLOCK" ? "blocked" : current === "blocked" ? current : "degraded");
        setMessage(
          policy?.integrityFailureMode === "BLOCK"
            ? "Required recording could not be stored. The assessment is blocked until monitoring recovers."
            : "Recording storage is degraded. You may continue, but this attempt requires human integrity review."
        );
      }
    }
  }, [attemptId, policy?.integrityFailureMode, report]);

  const startRecorder = useCallback((
    stream: MediaStream,
    source: "CAMERA" | "MICROPHONE" | "SCREEN" | "VIDEO_AUDIO" | "AUDIO_ONLY"
  ): void => {
    if (typeof MediaRecorder === "undefined") {
      void report("RECORDING_FAILED", { source, reason: "media_recorder_unavailable" }, "UNAVAILABLE");
      throw new Error("This browser cannot record required monitoring media.");
    }

    let recorder: MediaRecorder;
    try {
      const preferred = source === "AUDIO_ONLY" ? "audio/webm" : "video/webm";
      recorder = MediaRecorder.isTypeSupported(preferred)
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
    } catch {
      void report("RECORDING_FAILED", { source, reason: "media_recorder_start_failed" }, "DEGRADED");
      throw new Error("Required monitoring recording could not start.");
    }

    let segmentStartedAt = new Date().toISOString();
    recorder.addEventListener("dataavailable", (event) => {
      const endedAt = new Date().toISOString();
      const startedAt = segmentStartedAt;
      segmentStartedAt = endedAt;
      void uploadSegment(event.data, source, startedAt, endedAt);
    });
    recorder.addEventListener("error", () => {
      void report("RECORDING_FAILED", { source, reason: "media_recorder_error" }, "DEGRADED");
    });
    recorder.start(60_000);
    recorders.current.push(recorder);
    void report("RECORDING_STARTED", { source });
  }, [report, uploadSegment]);

  const stopAllMedia = useCallback((): void => {
    for (const recorder of recorders.current) {
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Browser may already be tearing the recorder down.
        }
      }
    }
    recorders.current = [];
    for (const stream of mediaStreams.current) {
      stream.getTracks().forEach((track) => track.stop());
    }
    mediaStreams.current = [];
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    fetch(`/api/worker/assessments/${encodeURIComponent(attemptId)}/integrity`, {
      cache: "no-store"
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("policy unavailable");
        return response.json() as Promise<{ policy: IntegrityPolicy }>;
      })
      .then(({ policy: loaded }) => {
        if (cancelled) return;
        setPolicy(loaded);
        if (requiresLiveMedia(loaded)) {
          setState("needs-start");
          setMessage("Start the monitoring required by this assessment before continuing.");
        } else {
          setState("ready");
          setMessage("Integrity event monitoring is active.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        // A submitted receipt or an already-closed attempt no longer has an active
        // integrity policy. The protected page itself remains the authority.
        setState("ready");
        setMessage("Active monitoring is not required on this assessment state.");
      });

    return () => {
      cancelled = true;
      mounted.current = false;
      stopAllMedia();
    };
  }, [attemptId, stopAllMedia]);

  useEffect(() => {
    const onVisibility = () => {
      void report(document.hidden ? "TAB_SWITCHED" : "BROWSER_RESUMED", {
        hidden: document.hidden
      });
    };
    const onBlur = () => void report("BROWSER_FOCUS_LOST");
    const onFocus = () => void report("BROWSER_RESUMED");
    const onFullscreen = () => {
      if (policy?.requireFullscreen && !document.fullscreenElement) {
        void report("FULLSCREEN_EXITED");
      }
    };
    const onOffline = () => void report("CONNECTION_INTERRUPTED", { online: false }, "DEGRADED");
    const onOnline = () => void report("BROWSER_RESUMED", { online: true });
    const onCopyPaste = (event: ClipboardEvent) => {
      void report("COPY_PASTE_DETECTED", { operation: event.type });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("copy", onCopyPaste, true);
    document.addEventListener("paste", onCopyPaste, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("copy", onCopyPaste, true);
      document.removeEventListener("paste", onCopyPaste, true);
    };
  }, [policy?.requireFullscreen, report]);

  const startMonitoring = async (): Promise<void> => {
    if (!policy) return;
    setState("starting");
    setMessage("Starting required assessment monitoring…");
    stopAllMedia();

    const failures: string[] = [];
    try {
      if (policy.requireFullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
        try {
          await document.documentElement.requestFullscreen();
        } catch {
          failures.push("fullscreen");
          await report("FULLSCREEN_EXITED", { reason: "fullscreen_start_failed" });
        }
      }

      if (policy.requireCamera || policy.requireMicrophone) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: policy.requireCamera,
            audio: policy.requireMicrophone
          });
          mediaStreams.current.push(stream);
          for (const track of stream.getTracks()) {
            track.addEventListener("ended", () => {
              const type = track.kind === "video" ? "CAMERA_UNAVAILABLE" : "MIC_UNAVAILABLE";
              void report(type, { reason: "track_ended" }, "DEGRADED");
              if (policy.integrityFailureMode === "BLOCK" && mounted.current) {
                setState("blocked");
                setMessage("Required monitoring stopped. Recover the device permission before continuing.");
              }
            });
          }
          if (policy.recordCamera || policy.recordMicrophone) {
            const source =
              policy.recordCamera && policy.recordMicrophone
                ? "VIDEO_AUDIO"
                : policy.recordCamera
                  ? "CAMERA"
                  : "AUDIO_ONLY";
            startRecorder(stream, source);
          }
        } catch {
          if (policy.requireCamera) {
            failures.push("camera");
            await report("CAMERA_UNAVAILABLE", { reason: "permission_or_device_failure" }, "DEGRADED");
          }
          if (policy.requireMicrophone) {
            failures.push("microphone");
            await report("MIC_UNAVAILABLE", { reason: "permission_or_device_failure" }, "DEGRADED");
          }
        }
      }

      if (policy.requireScreenShare) {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          mediaStreams.current.push(stream);
          const [track] = stream.getVideoTracks();
          track?.addEventListener("ended", () => {
            void report("SCREEN_UNAVAILABLE", { reason: "screen_share_ended" }, "DEGRADED");
            if (policy.integrityFailureMode === "BLOCK" && mounted.current) {
              setState("blocked");
              setMessage("Required screen sharing stopped. Restore monitoring before continuing.");
            }
          });
          if (policy.recordScreen) startRecorder(stream, "SCREEN");
        } catch {
          failures.push("screen");
          await report("SCREEN_UNAVAILABLE", { reason: "permission_or_device_failure" }, "DEGRADED");
        }
      }

      if (failures.length > 0) {
        await report(
          "MONITORING_PROVIDER_DEGRADED",
          { missing: failures.join(",") },
          "DEGRADED"
        );
        if (policy.integrityFailureMode === "BLOCK") {
          setState("blocked");
          setMessage(`Required monitoring is unavailable: ${failures.join(", ")}. Retry before continuing.`);
          return;
        }
        setState("degraded");
        setMessage(
          `Monitoring is degraded (${failures.join(", ")}). The assessment may continue but requires human integrity review.`
        );
        return;
      }

      await report("BROWSER_RESUMED", { monitoring: "started" });
      setState("ready");
      setMessage(
        policy.recordCamera || policy.recordMicrophone || policy.recordScreen
          ? `Required monitoring is active. Recordings are retained for ${policy.recordingRetentionDays} days unless a legal hold applies.`
          : "Required live monitoring is active."
      );
    } catch {
      await report("MONITORING_PROVIDER_DEGRADED", { reason: "monitor_start_failure" }, "DEGRADED");
      setState(policy.integrityFailureMode === "BLOCK" ? "blocked" : "degraded");
      setMessage(
        policy.integrityFailureMode === "BLOCK"
          ? "Required monitoring could not start. Retry before continuing."
          : "Monitoring could not fully start. You may continue, but this attempt requires human review."
      );
    }
  };

  const allowChildren =
    state === "ready" ||
    state === "degraded" ||
    (state === "blocked" && policy?.integrityFailureMode !== "BLOCK");

  return (
    <div className="content-stack">
      <section className="status-banner" aria-label="Assessment integrity status">
        <strong>Assessment monitoring</strong>
        <p>{message}</p>
        {(state === "needs-start" || state === "blocked") ? (
          <button className="button button-primary" type="button" onClick={() => void startMonitoring()}>
            {state === "blocked" ? "Retry required monitoring" : "Start required monitoring"}
          </button>
        ) : null}
      </section>
      {allowChildren ? children : (
        <section className="panel page-section">
          <h1>Assessment content is waiting</h1>
          <p>Complete the required monitoring step above before the question is shown.</p>
        </section>
      )}
    </div>
  );
}
