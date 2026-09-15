import { readFileSync } from "node:fs";

type DependencyFloor = {
  packagePath: string;
  minimum: string;
};

const dependencyFloors: DependencyFloor[] = [
  { packagePath: "node_modules/next", minimum: "16.3.3" },
  { packagePath: "node_modules/@next/env", minimum: "16.3.3" },
  { packagePath: "node_modules/eslint-config-next", minimum: "16.3.3" },
  { packagePath: "node_modules/sharp", minimum: "0.35.4" }
];

function versionAtLeast(actual: string, minimum: string) {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  return left[0] > right[0] ||
    (left[0] === right[0] && left[1] > right[1]) ||
    (left[0] === right[0] && left[1] === right[1] && left[2] >= right[2]);
}

export function checkLockedDependencyFloors(lockPath = "package-lock.json") {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));

  if (typeof lock !== "object" || lock === null || Array.isArray(lock)) {
    throw new Error("Dependency lock boundary rejected invalid lock data");
  }

  return dependencyFloors.map((floor) => {
    const version = lock.packages?.[floor.packagePath]?.version;
    return {
      ...floor,
      version,
      passed: Boolean(version && versionAtLeast(version, floor.minimum))
    };
  });
}
