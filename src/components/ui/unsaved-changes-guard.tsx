"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { installFormHistoryGuard } from "./form-history-guard";

const MESSAGE = "You have unsaved changes. Leave this page and discard them?";

// Values remain in page memory only. No draft or sensitive field is written to storage.
export function captureFormSnapshot(form: HTMLFormElement): string {
  return JSON.stringify(Array.from(form.elements).flatMap<readonly [string, unknown]>((control) => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)
      || !control.name || control.disabled) return [];
    if (control instanceof HTMLInputElement) {
      if (["hidden", "submit", "button", "reset"].includes(control.type)) return [];
      if (["checkbox", "radio"].includes(control.type)) return [[control.name, control.checked]];
      if (control.type === "file") return [[control.name, Array.from(control.files ?? []).map(file => [file.name, file.size, file.lastModified])]];
    }
    if (control instanceof HTMLSelectElement && control.multiple) return [[control.name, Array.from(control.selectedOptions).map(option => option.value)]];
    return [[control.name, control.value]];
  }));
}

export function UnsavedChangesGuard(): null {
  const pathname = usePathname();
  useEffect(() => {
    // Assessment workspaces own durable answer saving and interruption handling.
    if (pathname.startsWith("/worker/assessments/")) return;
    const main = document.querySelector("main");
    if (!main) return;
    let allowUnload = false;
    const baselines = new Map<HTMLFormElement, string>();
    const eligible = (form: HTMLFormElement) => form.getAttribute("method")?.toLowerCase() !== "get"
      && !form.closest('[data-unsaved-changes="ignore"]');
    const register = () => {
      for (const form of main.querySelectorAll("form")) {
        if (eligible(form) && !baselines.has(form)) baselines.set(form, captureFormSnapshot(form));
      }
      for (const form of baselines.keys()) if (!form.isConnected) baselines.delete(form);
    };
    register();
    const observer = new MutationObserver(register);
    observer.observe(main, { childList: true, subtree: true });
    const dirty = () => Array.from(baselines).some(([form, baseline]) =>
      form.isConnected && eligible(form) && captureFormSnapshot(form) !== baseline);
    const reset = (event: Event) => {
      if (event.target instanceof HTMLFormElement) {
        const form = event.target;
        // React server actions reset uncontrolled controls after accepted submissions.
        queueMicrotask(() => { if (!event.defaultPrevented && form.isConnected) baselines.set(form, captureFormSnapshot(form)); });
      }
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const next = new URL(link.href, window.location.href);
      if (!["http:", "https:"].includes(next.protocol)) return;
      if (next.origin === window.location.origin && next.pathname === window.location.pathname && next.search === window.location.search) return;
      if (dirty()) {
        if (!window.confirm(MESSAGE)) {
          event.preventDefault();
          event.stopPropagation();
        } else {
          allowUnload = true;
        }
      }
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!allowUnload && dirty()) { event.preventDefault(); event.returnValue = ""; }
    };
    const edited = () => { allowUnload = false; };
    const saved = (event: Event) => {
      if (event.target instanceof HTMLFormElement && event instanceof CustomEvent && typeof event.detail === "string") {
        baselines.set(event.target, event.detail);
      }
    };
    main.addEventListener("input", edited, true);
    main.addEventListener("change", edited, true);
    main.addEventListener("hse:form-saved", saved);
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const traverse = (event: Event) => {
      if ((event as Event & { navigationType?: string }).navigationType !== "traverse" || !event.cancelable || !dirty()) return;
      if (!window.confirm(MESSAGE)) event.preventDefault();
      else allowUnload = true;
    };
    navigation?.addEventListener("navigate", traverse);
    const removeHistoryGuard = navigation ? () => {} : installFormHistoryGuard(dirty, () => window.confirm(MESSAGE));
    document.addEventListener("click", click, true);
    main.addEventListener("reset", reset, true);
    window.addEventListener("beforeunload", unload);
    return () => {
      observer.disconnect();
      navigation?.removeEventListener("navigate", traverse);
      removeHistoryGuard();
      document.removeEventListener("click", click, true);
      main.removeEventListener("reset", reset, true);
      main.removeEventListener("input", edited, true);
      main.removeEventListener("change", edited, true);
      main.removeEventListener("hse:form-saved", saved);
      window.removeEventListener("beforeunload", unload);
      baselines.clear();
    };
  }, [pathname]);
  return null;
}
