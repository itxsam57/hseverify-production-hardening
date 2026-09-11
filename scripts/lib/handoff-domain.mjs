const FEATURE_RULES = [
  {
    id: "AUTH",
    label: "Authentication, login, logout and protected-route behaviour",
    roles: ["Worker", "Company", "Assessor", "Verifier", "Administrator", "Root"],
    risk: "high",
    visible: true,
    matches: (path) =>
      path === "src/proxy.ts" ||
      path.startsWith("src/lib/auth/") ||
      path.startsWith("src/app/auth/") ||
      /src\/app\/(worker|company|assessor|verifier|admin|root)\/login\//.test(path) ||
      path.startsWith("src/app/account/sessions/")
  },
  {
    id: "COMPANY_SCOPE_DEMO",
    label: "Company tenant-scope protected demonstration",
    roles: ["Company", "Worker"],
    risk: "high",
    visible: true,
    matches: (path) =>
      path.startsWith("src/app/company/(portal)/tenant-scope/") ||
      path === "src/components/company/tenant-scope-demonstration.tsx" ||
      path === "src/lib/authorization/company-scope-demonstration-domain.ts"
  },
  {
    id: "AUTHORIZATION",
    label: "Portal authorization and Company tenant isolation",
    roles: ["Worker", "Company", "Assessor", "Verifier", "Administrator", "Root"],
    risk: "high",
    visible: true,
    matches: (path) =>
      path.startsWith("src/lib/authorization/") ||
      path.includes("authorization_tenant_isolation") ||
      /src\/app\/(worker|company|assessor|verifier|admin|root)\/\(portal\)\/layout\.tsx$/.test(path)
  },
  {
    id: "WORKER",
    label: "Worker Dashboard, Profile and onboarding",
    roles: ["Worker"],
    risk: "medium",
    visible: true,
    matches: (path) =>
      path.startsWith("src/app/worker/") ||
      path.startsWith("src/components/worker/") ||
      path.startsWith("src/lib/worker/") ||
      path === "src/app/profile.css"
  },
  {
    id: "COMPANY",
    label: "Company Portal",
    roles: ["Company"],
    risk: "medium",
    visible: true,
    matches: (path) =>
      (path.startsWith("src/app/company/") &&
        !path.startsWith("src/app/company/(portal)/tenant-scope/")) ||
      (path.startsWith("src/components/company/") &&
        path !== "src/components/company/tenant-scope-demonstration.tsx") ||
      path.startsWith("src/lib/company/")
  },
  {
    id: "ASSESSOR",
    label: "Assessor Portal",
    roles: ["Assessor"],
    risk: "medium",
    visible: true,
    matches: (path) =>
      path.startsWith("src/app/assessor/") ||
      path.startsWith("src/components/assessor/") ||
      path.startsWith("src/lib/assessor/")
  },
  {
    id: "VERIFIER",
    label: "Verifier Portal",
    roles: ["Verifier"],
    risk: "medium",
    visible: true,
    matches: (path) =>
      path.startsWith("src/app/verifier/") ||
      path.startsWith("src/components/verifier/") ||
      path.startsWith("src/lib/verifier/")
  },
  {
    id: "ADMINISTRATION",
    label: "Administrator and Root operations",
    roles: ["Administrator", "Root"],
    risk: "high",
    visible: true,
    matches: (path) =>
      path.startsWith("src/app/admin/") ||
      path.startsWith("src/app/root/") ||
      path.startsWith("src/app/staff/") ||
      path.startsWith("src/components/auth/staff-")
  },
  {
    id: "SHARED_UI",
    label: "Shared navigation, controls and responsive layout",
    roles: ["Worker", "Company", "Assessor", "Verifier", "Administrator", "Root"],
    risk: "medium",
    visible: true,
    matches: (path) =>
      path.startsWith("src/components/ui/") ||
      path.startsWith("src/components/auth/role-") ||
      [
        "src/app/globals.css",
        "src/app/design-system.css",
        "src/app/design-system-integrations.css",
        "src/app/layout-containment.css",
        "src/app/layout.tsx",
        "src/app/error.tsx",
        "src/app/global-error.tsx",
        "src/app/not-found.tsx",
        "src/app/access-denied/page.tsx"
      ].includes(path)
  },
  {
    id: "PUBLIC",
    label: "Public landing and verification surfaces",
    roles: ["Public visitor", "Worker"],
    risk: "medium",
    visible: true,
    matches: (path) => path === "src/app/page.tsx" || path.startsWith("src/app/verify/")
  },
  {
    id: "API_SURFACE",
    label: "Server API routes",
    roles: ["Platform"],
    risk: "high",
    visible: false,
    matches: (path) => path.startsWith("src/app/api/")
  },
  {
    id: "SECURE_FILES",
    label: "Secure file storage, validation, scan and access pipeline",
    roles: ["Platform"],
    risk: "high",
    visible: false,
    matches: (path) =>
      path.startsWith("src/lib/secure-files/") ||
      path.startsWith("tests/secure-files/") ||
      path.startsWith("tests/platform/secure-file-") ||
      /scripts\/(check-secure-file|run-secure-access|run-secure-file|run-secure-upload|run-secure-scan)/.test(path)
  },
  {
    id: "DATABASE",
    label: "Database, migrations and persistence",
    roles: ["Platform"],
    risk: "high",
    visible: false,
    matches: (path) =>
      path.startsWith("database/") ||
      path.startsWith("src/lib/database/") ||
      /^scripts\/db-/.test(path)
  },
  {
    id: "BUILD_RELEASE",
    label: "Build, preview and release engineering",
    roles: ["Engineering"],
    risk: "medium",
    visible: false,
    matches: (path) =>
      path === "next.config.ts" ||
      path.startsWith("config/environments/") ||
      /scripts\/(build|clean-next|create-release|record-release|smoke-preview|typecheck-project)/.test(path)
  },
  {
    id: "ENGINEERING",
    label: "Engineering automation, CI and documentation",
    roles: ["Engineering", "Project owner"],
    risk: "low",
    visible: false,
    matches: (path) =>
      path.startsWith("docs/engineering/") ||
      path.startsWith(".github/workflows/") ||
      path.startsWith("tests/engineering/") ||
      /scripts\/(check-engineering|report-manual-handoff|run-engineering-gate|verify-affected)/.test(path) ||
      path === "scripts/lib/handoff-domain.mjs" ||
      path === "package.json" ||
      path === "package-lock.json" ||
      path === ".gitignore"
  }
];

function unique(values) {
  return [...new Set(values)];
}

function isUnclassifiedVisiblePath(path) {
  return (
    (path.startsWith("src/app/") && !path.startsWith("src/app/api/")) ||
    path.startsWith("src/components/")
  );
}

export function classifyChangedFiles(files) {
  const normalized = unique(
    files
      .map((value) => String(value).replaceAll("\\", "/").trim())
      .filter(Boolean)
  );
  const byId = new Map();
  const unmatched = [];

  for (const file of normalized) {
    const matched = FEATURE_RULES.filter((rule) => rule.matches(file));
    if (matched.length === 0) {
      unmatched.push(file);
      continue;
    }
    for (const rule of matched) {
      const current = byId.get(rule.id) ?? {
        id: rule.id,
        label: rule.label,
        roles: [],
        risk: rule.risk,
        visible: rule.visible,
        files: []
      };
      current.roles = unique([...current.roles, ...rule.roles]);
      current.files.push(file);
      byId.set(rule.id, current);
    }
  }

  const unknownVisible = unmatched.filter(isUnclassifiedVisiblePath);
  if (unknownVisible.length > 0) {
    byId.set("APPLICATION_UI", {
      id: "APPLICATION_UI",
      label: "Application user interface",
      roles: ["Affected portal user"],
      risk: "medium",
      visible: true,
      files: unknownVisible
    });
  }

  return {
    files: normalized,
    features: [...byId.values()],
    visibleFeatures: [...byId.values()].filter((feature) => feature.visible),
    internalFeatures: [...byId.values()].filter((feature) => !feature.visible),
    unmatched: unmatched.filter((file) => !isUnclassifiedVisiblePath(file))
  };
}

export function decideHandoffStatus({ gatePassed, visibleFeatureCount }) {
  if (!gatePassed) return "NOT READY — AUTOMATED ENGINEERING GATE FAILED";
  if (visibleFeatureCount === 0) return "NO MANUAL FEATURE TEST REQUIRED";
  return "READY FOR MANUAL BROWSER TESTING";
}

export function buildManualTests(visibleFeatures) {
  const tests = [];
  let number = 1;
  const add = (
    feature,
    role,
    start,
    data,
    steps,
    expected,
    refresh = "Not required unless explicitly listed."
  ) => {
    tests.push({
      id: `MAN-${String(number).padStart(3, "0")}`,
      feature: feature.label,
      role,
      start,
      data,
      steps,
      expected,
      refresh
    });
    number += 1;
  };

  for (const feature of visibleFeatures) {
    switch (feature.id) {
      case "AUTH":
        add(
          feature,
          "Worker",
          "/worker/login",
          "Existing synthetic local Worker account",
          [
            "Sign in with the Worker account.",
            "Confirm the Worker dashboard opens.",
            "Sign out.",
            "Paste `/worker/dashboard` directly into the address bar."
          ],
          "The Worker dashboard is never visible after logout; the Worker login page appears with the non-sensitive session-required reason."
        );
        add(
          feature,
          "Company",
          "/company/login",
          "Existing synthetic local Company account and valid TOTP",
          [
            "Sign in with the Company password.",
            "Complete TOTP.",
            "Confirm the Company dashboard opens.",
            "Sign out and paste `/company/dashboard` directly."
          ],
          "TOTP remains mandatory and the signed-out request returns to the Company login page."
        );
        break;
      case "COMPANY_SCOPE_DEMO":
        add(
          feature,
          "Company and Worker",
          "/company/login",
          "Existing synthetic local Company account with valid TOTP, existing synthetic Worker account, and synthetic demonstration text only",
          [
            "Sign in to the Company portal and complete TOTP.",
            "From the Company dashboard, open `Open tenant-scope demonstration`.",
            "Confirm the page shows a masked tenant reference, membership role, synthetic-data warning, and either an explicit empty state or only this tenant's existing demonstration records.",
            "Submit the create form with invalid or missing values and confirm field validation appears without losing the page.",
            "Create one record with a unique lowercase key and synthetic title/note; confirm it appears without a manual browser refresh.",
            "Edit that record and save; confirm the new value and incremented version appear without a manual browser refresh.",
            "Return to the Company dashboard, reopen the demonstration, and confirm the record remains present.",
            "Delete the record through the confirmation dialog and confirm it disappears with a success message.",
            "Sign out, sign in as Worker, paste `/company/tenant-scope`, and confirm Company content is never shown while the Worker session remains usable."
          ],
          "The demonstration is reachable only through the authenticated Company tenant, sends no tenant selector, updates without refresh-dependent navigation, persists within the current tenant, deletes only the selected neutral record, and denies Worker access without switching or corrupting the Worker session.",
          "Do not manually refresh to make create/update/delete appear. One later navigation away and return is required only to verify persistence."
        );
        break;
      case "AUTHORIZATION":
        add(
          feature,
          "Worker and Company",
          "Each role's login page",
          "Existing synthetic Worker and Company accounts",
          [
            "Sign in as Worker and paste `/company/dashboard`.",
            "Confirm Company content is never shown and the Worker session remains usable.",
            "Sign out, sign in as Company with TOTP, and paste `/worker/dashboard`.",
            "Confirm Worker content is never shown and the Company session remains usable."
          ],
          "Each copied cross-role URL reaches the access-denied boundary without switching or corrupting the valid session."
        );
        break;
      case "WORKER":
        add(
          feature,
          "Worker",
          "/worker/dashboard",
          "Existing synthetic Worker account",
          [
            "Open the changed Worker surface.",
            "Complete the changed visible action.",
            "Navigate away and return.",
            "Refresh once when the change is expected to persist."
          ],
          "The intended result is visible, controls remain functional, and durable values remain after refresh when applicable.",
          "Refresh is required only to verify persistence, not to make navigation work."
        );
        break;
      case "COMPANY":
        add(
          feature,
          "Company",
          "/company/dashboard",
          "Existing synthetic Company account and TOTP",
          [
            "Open the changed Company surface.",
            "Complete the changed visible action.",
            "Navigate away and return.",
            "Refresh once when persistence is relevant."
          ],
          "Only the current Company context is displayed and the changed result remains correct."
        );
        break;
      case "ASSESSOR":
      case "VERIFIER":
      case "ADMINISTRATION":
      case "PUBLIC":
      case "APPLICATION_UI":
        add(
          feature,
          feature.roles.join(", "),
          "The changed route listed in the feature request",
          "Synthetic non-production account when the surface is protected",
          [
            "Open the changed surface.",
            "Exercise each changed visible control.",
            "Confirm loading, validation, success, denial, and retry states that are visible for this change."
          ],
          "The changed workflow is complete, no decorative control appears, and no unrelated role or record is exposed."
        );
        break;
      case "SHARED_UI":
        add(
          feature,
          "All affected roles",
          "One representative dashboard plus each directly changed page",
          "Synthetic non-production accounts",
          [
            "Inspect desktop width.",
            "Inspect a narrow mobile width.",
            "Use keyboard Tab through changed controls.",
            "Confirm navigation and dialogs work without page-wide horizontal scrolling."
          ],
          "Shared UI remains readable, focus-visible, contained, and functional across affected roles."
        );
        break;
      default:
        add(
          feature,
          feature.roles.join(", "),
          "Affected surface",
          "Synthetic non-production data",
          ["Complete the visible changed workflow from start to durable result."],
          "The requested visible behaviour works without refresh-dependent navigation or cross-role/data leakage."
        );
    }
  }
  return tests;
}

export function summarizeUnaffectedFeatures(classification) {
  const affectedIds = new Set(classification.features.map((feature) => feature.id));
  const candidates = [
    ["Worker Dashboard/Profile", ["WORKER", "SHARED_UI", "AUTH", "AUTHORIZATION", "COMPANY_SCOPE_DEMO"]],
    ["Company Portal", ["COMPANY", "COMPANY_SCOPE_DEMO", "SHARED_UI", "AUTH", "AUTHORIZATION"]],
    ["Assessor Portal", ["ASSESSOR", "SHARED_UI", "AUTH", "AUTHORIZATION"]],
    ["Verifier Portal", ["VERIFIER", "SHARED_UI", "AUTH", "AUTHORIZATION"]],
    ["Administrator/Root operations", ["ADMINISTRATION", "SHARED_UI", "AUTH", "AUTHORIZATION"]],
    ["Secure file pipeline", ["SECURE_FILES", "API_SURFACE", "DATABASE"]],
    ["Database and migrations", ["DATABASE", "AUTH", "AUTHORIZATION", "WORKER", "COMPANY", "COMPANY_SCOPE_DEMO"]],
    ["Build and preview artifact", ["BUILD_RELEASE", "ENGINEERING"]]
  ];
  return candidates
    .filter(([, ids]) => !ids.some((id) => affectedIds.has(id)))
    .map(([label]) => label);
}
