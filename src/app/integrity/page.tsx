"use client";

import { useEffect, useRef, useState } from "react";

type DeviceState = "idle" | "checking" | "ready" | "unavailable";

export default function IntegrityPage() {
  const [state, setState] = useState("ACTIVE");
  const [deviceState, setDeviceState] = useState<DeviceState>("idle");
  const [message, setMessage] = useState("Your browser will ask for camera and microphone permission.");
  const hasReportedInteraction = useRef(false);

  useEffect(() => {
    fetch("/api/integrity/snapshot")
      .then((response) => response.json())
      .then((json) => {
        if (!hasReportedInteraction.current && json.integrity?.state) setState(json.integrity.state);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onBlur = () => void report("BROWSER_FOCUS_LOST");
    const onFocus = () => void report("BROWSER_RESUMED");
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  async function report(type: string) {
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
  }

  async function checkDevices() {
    setDeviceState("checking");
    setMessage("Waiting for browser permission…");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("media_devices_unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setDeviceState("ready");
      setMessage("Camera and microphone are ready. They are used only while monitored assessment checks are active.");
      await report("BROWSER_RESUMED");
    } catch {
      setDeviceState("unavailable");
      setMessage("We could not access both devices. Check browser permissions, or continue with limited monitoring.");
      await report("CAMERA_UNAVAILABLE");
    }
  }

  return (
    <main className="public-page">
      <section className="public-card" aria-labelledby="integrity-heading">
        <p className="section-kicker">Assessment readiness</p>
        <h1 id="integrity-heading">Camera and microphone check</h1>
        <p>Confirm your devices before starting. HSEVerify does not retain camera or microphone recordings from this check.</p>
        <p className="status-pill" data-testid="integrity-state">Integrity status: {state}</p>
        <div className="dashboard-section" aria-live="polite">
          <h2>{deviceState === "ready" ? "Devices ready" : deviceState === "unavailable" ? "Permission needed" : "Device access"}</h2>
          <p>{message}</p>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void checkDevices()} disabled={deviceState === "checking"}>
            {deviceState === "checking" ? "Checking devices…" : "Check camera and microphone"}
          </button>
          <button type="button" className="secondary-button" onClick={() => void report("CAMERA_UNAVAILABLE")}>
            Continue with limited monitoring
          </button>
        </div>
      </section>
    </main>
  );
}
