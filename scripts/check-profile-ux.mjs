import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const layout = readFileSync(resolve("src/app/layout.tsx"), "utf8");
const containmentCss = readFileSync(resolve("src/app/layout-containment.css"), "utf8");
const profileCss = readFileSync(resolve("src/app/profile.css"), "utf8");

for (const stylesheet of [
  'import "@/app/layout-containment.css"',
  'import "@/app/profile.css"'
]) {
  if (!layout.includes(stylesheet)) {
    console.error(`Root layout does not load required stylesheet: ${stylesheet}`);
    process.exit(1);
  }
}

const requiredProfileMarkers = [
  '.profile-field input:not([type="hidden"]):not([type="checkbox"])',
  ".profile-field select",
  ".profile-field textarea",
  "border: 1px solid #aebdc8",
  ":focus",
  ".profile-field-error",
  ".profile-checkbox",
  "container: worker-profile / inline-size",
  "@container worker-profile (max-width: 62rem)",
  "@container worker-profile (max-width: 46rem)",
  "grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem)",
  ".profile-history-card .ds-table-wrap",
  "overflow-x: auto",
  "overscroll-behavior-inline: contain"
];

for (const marker of requiredProfileMarkers) {
  if (!profileCss.includes(marker)) {
    console.error(`Worker Profile UX stylesheet is missing: ${marker}`);
    process.exit(1);
  }
}

const requiredShellMarkers = [
  ".portal-shell",
  ".portal-main-column",
  ".portal-content",
  ".portal-content > *",
  "min-width: 0",
  "max-width: 100%"
];

for (const marker of requiredShellMarkers) {
  if (!containmentCss.includes(marker)) {
    console.error(`Worker shell containment stylesheet is missing: ${marker}`);
    process.exit(1);
  }
}

if (/border:\s*0[^;]*;/.test(profileCss.match(/\.profile-field input[\s\S]*?\}/)?.[0] ?? "")) {
  console.error("Worker Profile text inputs must not remove their visible border.");
  process.exit(1);
}

if (profileCss.includes("minmax(300px")) {
  console.error("Worker Profile must not restore the fixed 300px action-column minimum.");
  process.exit(1);
}

if ((profileCss.match(/overflow-x:\s*auto;/g) ?? []).length !== 1) {
  console.error("Only the Profile history table wrapper may scroll horizontally.");
  process.exit(1);
}

if (/(?:body|\.portal-shell)\s*\{[^}]*overflow-x:\s*(?:hidden|clip)/s.test(containmentCss)) {
  console.error("Page-wide overflow must be repaired, not hidden on body or the portal shell.");
  process.exit(1);
}

console.log(
  "Worker Profile fields, container reflow, shell shrink containment, bounded actions and table-only horizontal scrolling passed."
);
