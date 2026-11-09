// Runs before application navigation so earlier login and portal entries are tagged too.
// Keep Next.js state intact; never add sentinel history entries.
export const FORM_HISTORY_TRACKING_SCRIPT = `(() => {
  if (window.navigation || window.__hseFormHistoryReady) return;
  window.__hseFormHistoryReady = true;
  const key = "__hseFormNavigationIndex";
  let index = Number.isSafeInteger(history.state?.[key]) ? history.state[key] : 0;
  const tag = (state, value) => state === null || typeof state === "object" ? { ...state, [key]: value } : state;
  const push = history.pushState, replace = history.replaceState;
  replace.call(history, tag(history.state, index), "", location.href);
  history.pushState = function(state, unused, url) {
    const next = index + 1;
    push.call(this, tag(state, next), unused, url);
    index = next;
    window.dispatchEvent(new Event("hse:history-state"));
  };
  history.replaceState = function(state, unused, url) {
    replace.call(this, tag(state, index), unused, url);
    window.dispatchEvent(new Event("hse:history-state"));
  };
  window.addEventListener("popstate", event => {
    if (Number.isSafeInteger(event.state?.[key])) index = event.state[key];
  }, true);
})();`;
