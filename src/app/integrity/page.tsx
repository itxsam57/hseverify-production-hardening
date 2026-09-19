"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type DeviceStatus = "not-checked" | "checking" | "ready" | "limited";

export default function IntegrityPage(): React.JSX.Element {
  const [state, setState] = useState("ACTIVE");
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>("not-checked");
  const [message, setMessage] = useState("Check your camera and microphone before starting an assessment.");
  const hasReportedInteraction = useRef(false);

  const report = useCallback(async (type: string): Promise<void> => {
    hasReportedInteraction.current = true;
    const response = await fetch("/api/integrity/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, occurredAt: new Date().toISOString() })
    });
    const json = await response.json();
    if (!response.ok || (!json.integrity?.state && !json.event?.state)) {
      throw new Error(json.error ?? "Unable to record integrity state.");
    }
    setState(json.integrity?.state ?? json.event.state);
  }, []);

  useEffect(() => {
    fetch("/api/integrity/snapshot")
      .then((response) => response.json())
      .then((json) => {
        if (!hasReportedInteraction.current && json.integrity?.state) {
          setState(json.integrity.state);
        }
      })
      .catch(() => setMessage("Integrity status will reconnect when the service is available."));
  }, []);

  useEffect(() => {
    const onBlur = () => void report("BROWSER_FOCUS_LOST").catch(() => undefined);
    const onFocus = () => void report("BROWSER_RESUMED").catch(() => undefined);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [report]);

  async function checkDevices(): Promise<void> {
    setDeviceStatus("checking");
    setMessage("Waiting for browser permission…");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Media devices are not available in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await report("BROWSER_RESUMED");
      setDeviceStatus("ready");
      setMessage("Camera and microphone are ready. No recording begins on this page.");
    } catch {
      await report("CAMERA_UNAVAILABLE").catch(() => undefined);
      setDeviceStatus("limited");
      setMessage("Camera or microphone permission is unavailable. You can continue, but monitoring will be limited and the assessment may require review.");
    }
  }

  async function continueLimited(): Promise<void> {
    await report("CAMERA_UNAVAILABLE").catch(() => undefined);
    setDeviceStatus("limited");
    setMessage("Limited monitoring has been recorded. You may continue when your assessment permits it.");
  }

  const stateClass = state === "ACTIVE" || state === "RECOVERED" ? "status-positive" : "status-warning";

  return (
    <main className="public-page" id="main-content">
      <section className="public-card">
        <p className="eyebrow">Assessment readiness</p>
        <h1>Device and integrity check</h1>
        <p className="page-intro">
          HSE Verify records availability and browser-focus signals during an assessment.
          Camera and microphone access is requested only after you choose to check them.
        </p>
      </section>

      <section className="public-card" aria-labelledby="device-check-heading">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">Current monitoring status</p>
            <h2 id="device-check-heading">Prepare this device</h2>
          </div>
          <span className={`status-badge ${stateClass}`} data-testid="integrity-state">
            {state}
          </span>
        </div>

        <div className="record-row" aria-live="polite">
          <div>
            <h3>
              {deviceStatus === "ready"
                ? "Device ready"
                : deviceStatus === "limited"
                  ? "Limited monitoring"
                  : deviceStatus === "checking"
                    ? "Checking permissions"
                    : "Permission check required"}
            </h3>
            <p>{message}</p>
          </div>
        </div>

        <div className="button-row">
          <button
            className="button button-primary"
            disabled={deviceStatus === "checking"}
            onClick={() => void checkDevices()}
            type="button"
          >
            {deviceStatus === "checking" ? "Checking…" : "Check camera and microphone"}
          </button>
          <button
            className="button button-secondary"
            onClick={() => void continueLimited()}
            type="button"
          >
            Continue with limited monitoring
          </button>
        </div>

        <p className="public-projection-note">
          This check does not save audio or video. It records readiness events used to protect assessment fairness and support review.
        </p>
      </section>
    </main>
  );
}
