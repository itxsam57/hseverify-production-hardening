"use client";

import { useRef, useState } from "react";
import { useEffect } from "react";

export default function IntegrityPage() {
  const [state, setState] = useState("ACTIVE");
  const hasReportedInteraction = useRef(false);

  useEffect(() => {
    fetch("/api/integrity/snapshot")
      .then((response) => response.json())
      .then((json) => {
        if (!hasReportedInteraction.current) {
          setState(json.integrity.state);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onBlur = () => report("BROWSER_FOCUS_LOST");
    const onFocus = () => report("BROWSER_RESUMED");
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
      body: JSON.stringify({
        type,
        occurredAt: new Date().toISOString()
      })
    });
    const json = await response.json();
    if (!response.ok || (!json.integrity?.state && !json.event?.state)) {
      throw new Error(json.error ?? "Unable to record integrity state.");
    }
    setState(json.integrity?.state ?? json.event.state);
  }

  return (
    <main>
      <h1>Assessment integrity</h1>
      <p data-testid="integrity-state">{state}</p>
      <button onClick={() => report("CAMERA_UNAVAILABLE")}>Simulate camera unavailable</button>
      <button onClick={() => report("BROWSER_RESUMED")}>Recover browser</button>
    </main>
  );
}
