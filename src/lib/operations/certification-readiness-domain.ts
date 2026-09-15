export type CertificationDrill = {
  name: "concurrency" | "tenant_isolation" | "restore" | "incident";
  status: "passed" | "failed";
  evidence: string;
};

export type CertificationSnapshot = {
  status: "certified" | "attention";
  drills: readonly CertificationDrill[];
  generatedAt: string;
};

export function buildCertificationSnapshot(
  drills: readonly CertificationDrill[]
): CertificationSnapshot {
  const requiredDrills = new Set<CertificationDrill["name"]>([
    "concurrency",
    "tenant_isolation",
    "restore",
    "incident"
  ]);
  const suppliedDrills = new Set(drills.map((drill) => drill.name));
  for (const required of requiredDrills) {
    if (!suppliedDrills.has(required)) {
      throw new Error("Certification snapshot is missing required drills.");
    }
  }
  for (const drill of drills) {
    if (!drill.evidence.trim()) {
      throw new Error("Certification drill evidence is required.");
    }
  }
  return Object.freeze({
    status: drills.some((drill) => drill.status === "failed") ? "attention" : "certified",
    drills: drills.map((drill) => Object.freeze({ ...drill })),
    generatedAt: new Date().toISOString()
  });
}

export function runLocalRecoveryCertificationFixture(): CertificationSnapshot {
  return buildCertificationSnapshot([
    { name: "concurrency", status: "passed", evidence: "duplicate-safe command execution" },
    { name: "tenant_isolation", status: "passed", evidence: "cross-tenant access denied" },
    { name: "restore", status: "passed", evidence: "state restore replay completed" },
    { name: "incident", status: "passed", evidence: "incident state transition recorded" }
  ]);
}
