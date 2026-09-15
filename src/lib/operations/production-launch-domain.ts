export type ReleaseHandoverCheck = {
  name: "runbook" | "support" | "alerts" | "rollback" | "acceptance";
  status: "passed" | "failed" | "pending";
};

export type ReleaseReadinessSnapshot = {
  status: "ready" | "attention";
  checks: readonly ReleaseHandoverCheck[];
  generatedAt: string;
};

const REQUIRED_CHECKS: readonly ReleaseHandoverCheck["name"][] = [
  "runbook",
  "support",
  "alerts",
  "rollback",
  "acceptance"
];

export function buildReleaseReadinessSnapshot(
  checks: readonly ReleaseHandoverCheck[]
): ReleaseReadinessSnapshot {
  if (
    checks.length !== REQUIRED_CHECKS.length ||
    new Set(checks.map((check) => check.name)).size !== REQUIRED_CHECKS.length ||
    REQUIRED_CHECKS.some((required) => !checks.some((check) => check.name === required))
  ) {
    throw new Error("exactly one status for every required release handover check is required");
  }
  for (const check of checks) {
    if (check.status !== "passed" && check.status !== "failed" && check.status !== "pending") {
      throw new Error("release handover status is invalid");
    }
  }

  return Object.freeze({
    status: checks.every((check) => check.status === "passed") ? "ready" : "attention",
    checks: checks.map((check) => Object.freeze({ ...check })),
    generatedAt: new Date().toISOString()
  });
}
