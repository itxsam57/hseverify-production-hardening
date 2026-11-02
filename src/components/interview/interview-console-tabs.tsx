"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type InterviewConsolePanel = Readonly<{ id: string; label: string; content: ReactNode }>;

export function InterviewConsoleTabs({ panels }: { panels: readonly InterviewConsolePanel[] }): React.JSX.Element {
  const prefix = useId();
  const [selected, setSelected] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="content-stack">
      <div role="tablist" aria-label="Interview workspace" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {panels.map((panel, index) => (
          <button key={panel.id} ref={element => { buttons.current[index] = element; }}
            id={prefix+"-tab-"+panel.id} role="tab" type="button"
            aria-selected={selected === index} aria-controls={prefix+"-panel-"+panel.id}
            tabIndex={selected === index ? 0 : -1}
            className={"button "+(selected === index ? "button-primary" : "button-secondary")}
            onClick={() => setSelected(index)}
            onKeyDown={event => {
              const next = event.key === "Home" ? 0 : event.key === "End" ? panels.length-1 :
                event.key === "ArrowRight" ? (index+1)%panels.length :
                event.key === "ArrowLeft" ? (index+panels.length-1)%panels.length : null;
              if (next !== null) { event.preventDefault(); setSelected(next); buttons.current[next]?.focus(); }
            }}>
            {panel.label}
          </button>
        ))}
      </div>
      {panels.map((panel, index) => (
        <div key={panel.id} id={prefix+"-panel-"+panel.id} role="tabpanel"
          aria-labelledby={prefix+"-tab-"+panel.id} hidden={selected !== index} tabIndex={0} style={{minWidth:0,overflowWrap:"anywhere"}}>
          {panel.content}
        </div>
      ))}
    </div>
  );
}

export function InterviewConsoleTimer({ seconds, running }: { seconds: number; running: boolean }): React.JSX.Element {
  const [elapsed, setElapsed] = useState(seconds);
  useEffect(() => {
    const start = performance.now();
    const update = () => setElapsed(seconds+(running ? Math.floor((performance.now()-start)/1000) : 0));
    update();
    if (!running) return;
    const timer = setInterval(update,1000);
    return () => clearInterval(timer);
  },[seconds,running]);
  return <p>Interview time: <output aria-label="Interview duration">{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,"0")}</output>{running ? " · Running" : " · Stopped"}</p>;
}
