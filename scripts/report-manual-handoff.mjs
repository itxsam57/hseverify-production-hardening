import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildManualTests,
  classifyChangedFiles,
  decideHandoffStatus,
  summarizeUnaffectedFeatures
} from "./lib/handoff-domain.mjs";

const outputDirectory = resolve(".engineering");
const resultPath = resolve(outputDirectory, "verification-result.json");
const reportPath = resolve(outputDirectory, "manual-test-handoff.md");

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  }).trim();
}

function canResolve(ref) {
  try {
    git(["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef() {
  const candidates = [
    process.env.HANDOFF_BASE_REF,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    "origin/main",
    "main",
    "HEAD^"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (canResolve(candidate)) return candidate;
  }
  return null;
}

function changedFiles(baseRef) {
  if (!baseRef) return [];
  const output = git(["diff", "--name-only", "--diff-filter=ACMRDTUXB", `${baseRef}...HEAD`]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function safeJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function requestedChange(baseRef) {
  if (process.env.HANDOFF_REQUEST?.trim()) return process.env.HANDOFF_REQUEST.trim();
  if (baseRef) {
    try {
      const messages = git(["log", "--format=%s", `${baseRef}..HEAD`])
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, 3);
      if (messages.length > 0) return messages.join("; ");
    } catch {
      // Fall through to the current commit subject.
    }
  }
  try {
    return git(["log", "-1", "--format=%s"]);
  } catch {
    return "Repository engineering verification.";
  }
}

function formatManualTests(tests) {
  if (tests.length === 0) {
    return "No browser-visible product behaviour changed. Internal/server changes are covered by the automated engineering gate, so the owner does not need to invent a browser test for this change.";
  }

  return tests
    .map(
      (test) => `### ${test.id}

- **Related feature:** ${test.feature}
- **Role/account:** ${test.role}
- **Starting page:** \`${test.start}\`
- **Required test data:** ${test.data}
- **Steps:**
${test.steps.map((step, index) => `  ${index + 1}. ${step}`).join("\n")}
- **Expected visible result:** ${test.expected}
- **Refresh expectation:** ${test.refresh}`
    )
    .join("\n\n");
}

function verificationSummary(result) {
  if (!result) return "- Automated gate result is unavailable. Run `npm run verify:full` before handoff.";
  return result.checks
    .map((check) => `- **${check.name}:** ${check.status}`)
    .join("\n");
}

function selectVisibleHandoffFeatures(classification) {
  const companyScope = classification.visibleFeatures.find(
    (feature) => feature.id === "COMPANY_SCOPE_DEMO"
  );
  if (companyScope) {
    // This exact workflow already includes Company login/TOTP, dashboard entry,
    // no-refresh CRUD, Worker copied-route denial and session continuity. Do not
    // make the owner repeat generic Company/auth/authorization variants.
    return [companyScope];
  }
  return classification.visibleFeatures;
}

function workerIdentityWorkflowHandoff(files) {
  const identitySurfaceChanged = files.some(
    (path) =>
      path.startsWith("src/app/worker/(portal)/identity/") ||
      path === "src/components/worker/identity-workspace.tsx"
  );
  if (!identitySurfaceChanged) return null;

  const feature = {
    id: "WORKER_IDENTITY",
    label: "Worker Identity onboarding, evidence and correction workflow",
    roles: ["Worker", "Company"],
    risk: "high",
    visible: true,
    files: files.filter(
      (path) =>
        path.startsWith("src/app/worker/(portal)/identity/") ||
        path === "src/components/worker/identity-workspace.tsx" ||
        path === "src/components/worker/worker-navigation.tsx"
    )
  };

  return {
    feature,
    tests: [
      {
        id: "MAN-001",
        feature: feature.label,
        role: "Worker",
        start: "/worker/identity",
        data: "Synthetic local Worker with verified email and phone, synthetic PDF/PNG/JPEG identity evidence, plus a second synthetic Worker if the withdrawal path is tested",
        steps: [
          "Sign in as the synthetic Worker and open `Identity` from Worker navigation; confirm `/worker/identity` opens without a refresh workaround.",
          "Confirm verified email and phone are displayed read-only and cannot be supplied or changed by the identity form.",
          "Save partial legal/personal identity details, navigate away and return, then refresh once; confirm the saved draft remains.",
          "Open the same identity in a second tab, save a newer draft in tab A, then submit the stale form in tab B; confirm tab B reports/reloads the conflict instead of silently overwriting tab A.",
          "Upload only synthetic evidence: one supported identity document plus profile photo and selfie. Confirm each accepted file is security-scanned and appears attached only after it becomes available.",
          "Try one invalid or mismatched synthetic file and confirm a safe validation/scanning error appears without attaching it.",
          "Replace one attached evidence item while the version is still editable; confirm the replacement becomes current without exposing storage paths or object keys.",
          "Submit the completed identity; confirm legal details and evidence become non-editable and the pre-review withdrawal control appears.",
          "If testing withdrawal, use the second Worker because withdrawal is terminal for that submission. Confirm withdrawal works only before automated/manual review starts.",
          "For the non-withdrawn Worker, submit and run automated checks. In local/test, confirm assistive results appear and the workflow can advance to manual review without claiming a final verified/rejected decision.",
          "Do not manufacture a verified lifecycle state to test correction decisions. Correction lineage/accept-or-reject authority remains automated-tested until the reviewer workflow that owns that decision is built in M2.02."
        ],
        expected: "The real Worker Identity route preserves versioned drafts, server-bound verified contacts, private scanned evidence, stale-write protection and immutable submitted state. Automated checks remain assistive and cannot self-verify the Worker.",
        refresh: "Refresh once only to verify persistence. Saving, uploading, submitting, withdrawing and scheduling checks must not depend on a manual refresh to take effect."
      },
      {
        id: "MAN-002",
        feature: feature.label,
        role: "Company then Worker",
        start: "/company/login",
        data: "Synthetic local Company account with valid TOTP and the synthetic Worker account used above",
        steps: [
          "Sign in as Company, paste `/worker/identity`, and confirm Worker identity content is never shown while the Company session remains usable.",
          "Sign out, sign in as Worker and reopen `/worker/identity` at desktop width, 390x844 and 320x700.",
          "Use keyboard Tab through the changed identity forms, file controls and action buttons; confirm visible focus and no page-wide horizontal scrolling."
        ],
        expected: "The Identity surface remains Worker-only, cross-role access fails closed, and the visible workflow stays usable at desktop/mobile widths and by keyboard.",
        refresh: "No refresh is required for authorization or responsive behavior."
      }
    ]
  };
}

function finalM104Closure(files) {
  if (!files.includes("docs/M1_04_FINAL_ISOLATION_AND_ACCEPTANCE.md")) {
    return null;
  }

  return {
    feature: {
      id: "M1_04_FINAL",
      label: "M1.04 final portal-isolation closure",
      roles: ["Company", "Worker"],
      risk: "high",
      visible: true,
      files
    },
    test: {
      id: "MAN-001",
      feature: "M1.04 final portal-isolation closure",
      role: "Company and signed-out Worker route",
      start: "/worker/profile",
      data: "Existing synthetic local Company account with valid TOTP",
      steps: [
        "Fully sign out, paste `/worker/profile`, and confirm `/worker/login?reason=session-required` opens without Worker Profile or global Not available content.",
        "Sign in to the Company portal and complete TOTP; confirm the Company dashboard opens.",
        "Paste `/worker/profile`; confirm Worker content never appears and Access Denied is shown.",
        "Use `Return to active portal`; confirm the Company dashboard and session still work, then sign out."
      ],
      expected: "The representative newly covered signed-out endpoint redirects before protected rendering, and a valid Company session cannot enter the Worker portal or become corrupted. The other ten signed-out endpoints and twenty-nine cross-role combinations are covered automatically.",
      refresh: "No manual refresh is required."
    }
  };
}

mkdirSync(outputDirectory, { recursive: true });

const baseRef = resolveBaseRef();
const files = changedFiles(baseRef);
const classification = classifyChangedFiles(files);
const finalClosure = finalM104Closure(files);
const identityHandoff = finalClosure ? null : workerIdentityWorkflowHandoff(files);
const handoffFeatures = finalClosure
  ? [finalClosure.feature]
  : identityHandoff
    ? [identityHandoff.feature]
    : selectVisibleHandoffFeatures(classification);
const result = safeJson(resultPath);
const gatePassed = result?.status === "PASS";
const status = decideHandoffStatus({
  gatePassed,
  visibleFeatureCount: handoffFeatures.length
});
const tests = finalClosure
  ? [finalClosure.test]
  : identityHandoff
    ? identityHandoff.tests
    : buildManualTests(handoffFeatures);
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || (() => {
  try {
    return git(["branch", "--show-current"]) || "detached";
  } catch {
    return "unknown";
  }
})();
const commit = (() => {
  try {
    return git(["rev-parse", "HEAD"]);
  } catch {
    return "unknown";
  }
})();
const preview =
  process.env.PREVIEW_URL ||
  process.env.DEPLOYMENT_URL ||
  "No hosted preview URL is configured. CI produces a provider-neutral preview artifact.";
const unaffected = summarizeUnaffectedFeatures(classification);

const report = `${status}

# HSE Verify Manual Test Handoff

## Build information

- **Project:** HSE Verify
- **Branch:** \`${branch}\`
- **Commit:** \`${commit}\`
- **Base:** \`${baseRef ?? "unresolved"}\`
- **Preview/runnable link:** ${preview}
- **Automated gate:** ${gatePassed ? "PASS" : result?.status ?? "NOT RUN"}

## Requested change

${requestedChange(baseRef)}

## Visible features changed

${
  handoffFeatures.length === 0
    ? "- None. This change has no browser-visible surface; any internal product/security changes are listed separately below and remain subject to the automated gate."
    : handoffFeatures
        .map(
          (feature) =>
            `- **${feature.label}** — ${feature.roles.join(", ")} — ${feature.risk.toUpperCase()} risk`
        )
        .join("\n")
}

## Internal engineering areas changed

${
  classification.internalFeatures.length === 0
    ? "- None identified."
    : classification.internalFeatures
        .map((feature) => `- ${feature.label}`)
        .join("\n")
}

## Exact manual tests

${formatManualTests(tests)}

## Regression areas to spot-check

${
  handoffFeatures.length === 0
    ? "- No owner browser regression spot-check is required. Internal/server regression coverage is part of the automated engineering gate."
    : "- Use only the regression areas named inside the manual tests above; do not retest the whole product."
}

## Unaffected areas

${
  unaffected.length === 0
    ? "- No major area can be confidently excluded because shared high-impact code changed."
    : unaffected.map((item) => `- ${item}`).join("\n")
}

## Setup requirements

${
  tests.length === 0
    ? "- None for owner browser testing."
    : "- Before starting the local server, run `npm run setup:local` so environment validation and every pending database migration complete.\n- Use only synthetic local accounts and data. Never use production credentials, users, documents, or tenant records."
}

## Automated evidence

${verificationSummary(result)}

## Known limitations

- There is no repository-controlled hosted preview URL.
- Permanent Playwright Chromium browser automation runs in CI for the permanent Hard Browser QA and retrospective completed-workflow gates; owner manual testing remains limited to specifically named handoff checks.
- Production activation remains blocked for approved live email/SMS/private-object-storage/malware-scanning/liveness/video-interview/payment providers; accepted local/test adapters are not live production providers.
- Generated reports are intentionally concise; complete successful logs remain in CI only.

## Classification diagnostics

- Changed files examined: ${classification.files.length}
- Handoff-visible features after overlap consolidation: ${handoffFeatures.length}
- Unmatched non-UI files: ${classification.unmatched.length}
`;

writeFileSync(reportPath, report, "utf8");
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, "utf8");
}
console.log(report);