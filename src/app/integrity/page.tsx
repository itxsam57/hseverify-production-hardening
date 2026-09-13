"use client";

import { useState } from "react";
import { useEffect } from "react";

export default function IntegrityPage() {
  const [state, setState] = useState("ACTIVE");

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
    const response = await fetch("/api/integrity/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type })
    });
    const json = await response.json();
    setState(json.event.state);
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
