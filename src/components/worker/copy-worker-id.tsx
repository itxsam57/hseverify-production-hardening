"use client";

import { useState } from "react";

export function CopyWorkerId({ workerId }: { workerId: string }): React.JSX.Element {
  const [message, setMessage] = useState("");
  const permanent = /^HSE-WRK-[A-Z0-9-]+$/.test(workerId);

  if (!permanent) {
    return (
      <div className="copy-control">
        <button
          className="button button-secondary button-small"
          disabled
          type="button"
        >
          Worker ID not issued
        </button>
        <span className="copy-feedback">
          HSE-REG references are provisional and cannot be used as a permanent Worker ID.
        </span>
      </div>
    );
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(workerId);
      setMessage("Worker ID copied.");
    } catch {
      setMessage("Copy failed. Select the Worker ID and copy it manually.");
    }

    window.setTimeout(() => setMessage(""), 4000);
  }

  return (
    <div className="copy-control">
      <button className="button button-secondary button-small" onClick={copy} type="button">
        Copy Worker ID
      </button>
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
      {message ? <span className="copy-feedback" aria-hidden="true">{message}</span> : null}
    </div>
  );
}
