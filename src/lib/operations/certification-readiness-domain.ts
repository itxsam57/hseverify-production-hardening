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

export type CertificationDrillRunner = () => Promise<string> | string;

export type CertificationDrillRunners = Record<CertificationDrill["name"], CertificationDrillRunner>;

export function assertCertificationSnapshotIsReady(snapshot: CertificationSnapshot): void {
  if (snapshot.status !== "certified") {
    throw new Error("Certification snapshot is not ready.");
  }

  for (const drill of snapshot.drills) {
    if (drill.status !== "passed") {
      throw new Error("Certification snapshot contains failed drills.");
    }
  }
}

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
  if (suppliedDrills.size !== drills.length) {
    throw new Error("Certification snapshot cannot contain duplicate drills.");
  }
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

export async function runCertificationDrills(
  runners: CertificationDrillRunners
): Promise<CertificationSnapshot> {
  const drills: CertificationDrill[] = [];
  for (const name of ["concurrency", "tenant_isolation", "restore", "incident"] as const) {
    try {
      const evidence = await runners[name]();
      drills.push({ name, status: "passed", evidence });
    } catch (error) {
      drills.push({
        name,
        status: "failed",
        evidence: error instanceof Error ? error.message : "Certification drill failed"
      });
    }
  }
  return buildCertificationSnapshot(drills);
}

export function buildEmptyCertificationSnapshot(): CertificationSnapshot {
  return buildCertificationSnapshot([
    { name: "concurrency", status: "failed", evidence: "No certification drill recorded" },
    { name: "tenant_isolation", status: "failed", evidence: "No certification drill recorded" },
    { name: "restore", status: "failed", evidence: "No certification drill recorded" },
    { name: "incident", status: "failed", evidence: "No certification drill recorded" }
  ]);
}
