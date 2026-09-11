import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const lockfile = JSON.parse(
  readFileSync(resolve("package-lock.json"), "utf8")
);

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value ?? "");
  if (!match) {
    throw new Error(`Invalid locked semantic version: ${String(value)}`);
  }
  return match.slice(1).map(Number);
}

function atLeast(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

const requirements = [
  {
    path: "node_modules/next",
    minimum: "16.3.3",
    advisory: "GHSA-p293-qw3h-jr36 and GHSA-2xp9-vwfh-vxw4 remote-code-execution advisories"
  },
  {
    path: "node_modules/nanoid",
    minimum: "3.3.18",
    advisory: "Nano ID zero-size custom-generator denial-of-service advisory"
  },
  {
    path: "node_modules/postcss",
    minimum: "8.5.23",
    advisory: "PostCSS source-map disclosure and CSS stringify advisories"
  },
  {
    path: "node_modules/sharp",
    minimum: "0.35.4",
    advisory: "GHSA-rgj7-g3m4-5g8c libheif image-processing advisory"
  }
];

for (const requirement of requirements) {
  const entry = lockfile.packages?.[requirement.path];
  if (!entry?.version) {
    console.error(`Required locked package is missing: ${requirement.path}`);
    process.exit(1);
  }

  if (!atLeast(entry.version, requirement.minimum)) {
    console.error(
      `${requirement.path} is locked at ${entry.version}; ${requirement.advisory} require at least ${requirement.minimum}.`
    );
    process.exit(1);
  }

  console.log(`${requirement.path}: ${entry.version} (minimum ${requirement.minimum})`);
}

console.log("Locked production transitive dependencies meet the recorded security floors.");
