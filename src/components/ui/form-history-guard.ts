const KEY = "__hseFormNavigationIndex";
function indexOf(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[KEY];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

// A popstate cannot be canceled. Restore the exact source entry before asking,
// then replay only an accepted traversal. No URL reconstruction or extra entries.
export function installFormHistoryGuard(blocked: () => boolean, confirm: () => boolean): () => void {
  let current = indexOf(window.history.state);
  let restoring: { source: number; target: number } | null = null;
  let replay: number | null = null;
  const changed = () => { if (!restoring && replay === null) current = indexOf(window.history.state); };
  const pop = (event: PopStateEvent) => {
    const target = indexOf(event.state);
    if (target === null || current === null) return;
    if (restoring) {
      event.stopImmediatePropagation();
      if (target !== restoring.source) {
        window.history.go(restoring.source - target);
        return;
      }
      const intent = restoring;
      restoring = null;
      if (confirm()) {
        replay = intent.target;
        window.history.go(intent.target - intent.source);
      }
      return;
    }
    if (replay !== null) {
      // Only the approved destination may reach the router.
      if (target !== replay) { event.stopImmediatePropagation(); return; }
      replay = null;
      current = target;
      return;
    }
    if (target !== current && blocked()) {
      event.stopImmediatePropagation();
      restoring = { source: current, target };
      window.history.go(current - target);
      return;
    }
    current = target;
  };
  window.addEventListener("hse:history-state", changed);
  window.addEventListener("popstate", pop, true);
  return () => {
    window.removeEventListener("hse:history-state", changed);
    window.removeEventListener("popstate", pop, true);
  };
}
