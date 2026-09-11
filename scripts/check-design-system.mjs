import { readFile } from "node:fs/promises";

const files = {
  css: "src/app/design-system.css",
  integrations: "src/app/design-system-integrations.css",
  rootLayout: "src/app/layout.tsx",
  portalLayout: "src/app/worker/(portal)/layout.tsx",
  login: "src/app/worker/login/login-form.tsx",
  profile: "src/app/worker/(portal)/profile/page.tsx",
  shell: "src/components/worker/worker-shell.tsx",
  workerBadge: "src/components/worker/status-badge.tsx",
  button: "src/components/ui/button.tsx",
  field: "src/components/ui/field.tsx",
  feedback: "src/components/ui/feedback.tsx",
  badge: "src/components/ui/status-badge.tsx",
  table: "src/components/ui/data-table.tsx",
  dialog: "src/components/ui/confirm-dialog.tsx",
  surface: "src/components/ui/surface.tsx"
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([name, path]) => [name, await readFile(path, "utf8")])
  )
);

function requireText(name, text, expected) {
  if (!text.includes(expected)) {
    throw new Error(`${name} must include ${JSON.stringify(expected)}.`);
  }
}

for (const token of [
  "--ds-color-canvas",
  "--ds-color-surface",
  "--ds-color-text",
  "--ds-color-border",
  "--ds-space-4",
  "--ds-radius-md",
  "--ds-control-height",
  "--ds-touch-target",
  "--ds-focus-ring",
  "--ds-motion-fast",
  "--ds-z-dialog"
]) {
  requireText("design-system.css", source.css, token);
}

for (const contract of [
  ".ds-button",
  ".ds-input",
  ".ds-select",
  ".ds-textarea",
  ".ds-alert",
  ".ds-card",
  ".ds-badge",
  ".ds-table",
  ".ds-dialog",
  ".ds-empty-state",
  ".ds-skeleton",
  ":focus-visible",
  "prefers-reduced-motion",
  "prefers-contrast",
  "forced-colors",
  "@media (max-width: 860px)"
]) {
  requireText("design-system.css", source.css, contract);
}

requireText("root layout", source.rootLayout, "@/app/design-system.css");
requireText("root layout", source.rootLayout, "@/app/design-system-integrations.css");
requireText("integration styles", source.integrations, ".profile-panel .ds-dialog .ds-button");
if (source.portalLayout.includes("profile.css")) {
  throw new Error("Worker portal layout must not load duplicate page-specific profile CSS.");
}

requireText("shared button", source.button, "ds-button");
requireText("shared field", source.field, "ds-input");
requireText("shared field", source.field, "ds-checkbox");
requireText("shared feedback", source.feedback, "ds-empty-state");
requireText("shared feedback", source.feedback, "aria-busy=\"true\"");
requireText("shared badge", source.badge, "ds-badge");
requireText("shared table", source.table, "<caption>");
requireText("shared table", source.table, "scope=\"col\"");
requireText("shared dialog", source.dialog, "showModal()");
requireText("shared dialog", source.dialog, "aria-labelledby");
requireText("shared surface", source.surface, "ds-card");

requireText("Worker login", source.login, "@/components/ui/field");
requireText("Worker login", source.login, "@/components/ui/button");
requireText("Worker login", source.login, "@/components/ui/feedback");
requireText("Worker shell", source.shell, "mobile-nav-menu");
requireText("Worker shell", source.shell, "Open Worker Portal navigation");
requireText("Worker shell", source.shell, "ConfirmDialog");
requireText("Worker shell", source.shell, "Unsaved form changes will not be kept");
requireText("Worker profile", source.profile, "DataTable");
requireText("Worker profile", source.profile, "EmptyState");
requireText("Worker status badge", source.workerBadge, "UiStatusBadge");

console.log(
  "Shared design tokens, controls, feedback, table, dialog, responsive navigation and accessibility contracts passed."
);
