import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const GENERATED_NEXT_ROOT_NAME = ".hse-next";
export const DEVELOPMENT_DIST_DIR_NAME = ".next-development";
export const TYPECHECK_DIST_DIR_NAME = ".next-typecheck";
export const RUNTIME_SMOKE_DIST_DIR_NAME = ".next-runtime-smoke";
export const PRODUCTION_DIST_DIR_NAME = ".next";

const NEXT_MODES = new Set([
  "development",
  "typecheck",
  "runtime-smoke",
  "production-build"
]);
const PROTECTED_CONFIGURATION_FILES = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json"
];
const DIST_DIRECTORIES = [
  DEVELOPMENT_DIST_DIR_NAME,
  TYPECHECK_DIST_DIR_NAME,
  RUNTIME_SMOKE_DIST_DIR_NAME,
  PRODUCTION_DIST_DIR_NAME
];

function assertMode(mode) {
  if (!NEXT_MODES.has(mode)) {
    throw new Error(`Unsupported Next command mode: ${mode}`);
  }
}

async function removeDirectory(path) {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 150
  });
}

async function removeGeneratedRootWhenEmpty(generatedRoot) {
  try {
    const entries = await readdir(generatedRoot);
    if (entries.length === 0) await removeDirectory(generatedRoot);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
}

async function fileDigest(path) {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

function normalizeInstanceId(instanceId) {
  if (instanceId === null || instanceId === undefined || instanceId === "") return null;
  const value = String(instanceId).trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error("Next command instance ID is invalid.");
  }
  return value;
}

function modeDefinition(mode, instanceId = null) {
  assertMode(mode);
  const normalizedInstanceId = normalizeInstanceId(instanceId);

  if (mode === "development") {
    const suffix = normalizedInstanceId ? `-${normalizedInstanceId}` : "";
    const distDirName = `${DEVELOPMENT_DIST_DIR_NAME}${suffix}`;
    return {
      commandMode: "development",
      instanceId: normalizedInstanceId,
      generatedModeName: `development${suffix}`,
      distDirName,
      generatedTypeIncludes: [
        `../../${distDirName}/types/**/*.ts`,
        `../../${distDirName}/dev/types/**/*.ts`
      ]
    };
  }

  if (mode === "typecheck") {
    return {
      commandMode: "typegen",
      instanceId: null,
      generatedModeName: "typecheck",
      distDirName: TYPECHECK_DIST_DIR_NAME,
      generatedTypeIncludes: [
        `../../${TYPECHECK_DIST_DIR_NAME}/types/**/*.ts`,
        `../../${TYPECHECK_DIST_DIR_NAME}/dev/types/**/*.ts`
      ]
    };
  }

  if (mode === "runtime-smoke") {
    return {
      commandMode: "runtime-smoke",
      instanceId: null,
      generatedModeName: "runtime-smoke",
      distDirName: RUNTIME_SMOKE_DIST_DIR_NAME,
      generatedTypeIncludes: [
        `../../${RUNTIME_SMOKE_DIST_DIR_NAME}/types/**/*.ts`,
        `../../${RUNTIME_SMOKE_DIST_DIR_NAME}/dev/types/**/*.ts`
      ]
    };
  }

  return {
    commandMode: "production-build",
    instanceId: null,
    generatedModeName: "production-build",
    distDirName: PRODUCTION_DIST_DIR_NAME,
    generatedTypeIncludes: [`../../${PRODUCTION_DIST_DIR_NAME}/types/**/*.ts`]
  };
}

function generatedTsconfig(definition, mode) {
  const exclude = [
    "../../node_modules",
    ...DIST_DIRECTORIES.filter(
      (distDirName) => distDirName !== definition.distDirName
    ).map((distDirName) => `../../${distDirName}`)
  ];

  if (mode === "production-build") {
    exclude.push(`../../${PRODUCTION_DIST_DIR_NAME}/dev`);
  }

  return {
    extends: "../../tsconfig.json",
    compilerOptions: {
      tsBuildInfoFile: "./cache/typescript.tsbuildinfo"
    },
    include: [
      "../../next-env.d.ts",
      ...definition.generatedTypeIncludes,
      "../../src/**/*.ts",
      "../../src/**/*.tsx",
      "../../next.config.ts"
    ],
    exclude
  };
}

export async function snapshotProjectConfiguration(projectRoot = process.cwd()) {
  const snapshot = new Map();

  for (const relativePath of PROTECTED_CONFIGURATION_FILES) {
    const absolutePath = resolve(projectRoot, relativePath);
    snapshot.set(relativePath, await fileDigest(absolutePath));
  }

  return snapshot;
}

export async function assertProjectConfigurationUnchanged(
  snapshot,
  projectRoot = process.cwd()
) {
  const changed = [];

  for (const [relativePath, beforeDigest] of snapshot.entries()) {
    const afterDigest = await fileDigest(resolve(projectRoot, relativePath));
    if (afterDigest !== beforeDigest) changed.push(relativePath);
  }

  if (changed.length > 0) {
    throw new Error(
      `Next command modified protected project configuration: ${changed.join(", ")}`
    );
  }
}

export async function prepareNextMode(mode, projectRoot = process.cwd(), instanceId = null) {
  const definition = modeDefinition(mode, instanceId);
  const generatedRoot = resolve(projectRoot, GENERATED_NEXT_ROOT_NAME);
  const modeRoot = resolve(generatedRoot, definition.generatedModeName);
  const distDir = resolve(projectRoot, definition.distDirName);

  await removeDirectory(modeRoot);

  if (mode === "production-build") {
    await removeDirectory(resolve(projectRoot, TYPECHECK_DIST_DIR_NAME));
    await removeDirectory(resolve(projectRoot, RUNTIME_SMOKE_DIST_DIR_NAME));
    await removeDirectory(resolve(projectRoot, PRODUCTION_DIST_DIR_NAME));
  } else {
    await removeDirectory(distDir);
  }

  await mkdir(resolve(modeRoot, "cache"), { recursive: true });

  const tsconfigPath = resolve(modeRoot, "tsconfig.json");
  await writeFile(
    tsconfigPath,
    `${JSON.stringify(generatedTsconfig(definition, mode), null, 2)}\n`,
    "utf8"
  );

  return {
    ...definition,
    distDir,
    generatedRoot,
    modeRoot,
    tsconfigPath,
    environment: {
      HSE_NEXT_COMMAND_MODE: definition.commandMode,
      ...(definition.instanceId
        ? { HSE_NEXT_INSTANCE_ID: definition.instanceId }
        : {})
    }
  };
}

export async function cleanGeneratedConfiguration(
  mode,
  projectRoot = process.cwd()
) {
  assertMode(mode);
  const generatedRoot = resolve(projectRoot, GENERATED_NEXT_ROOT_NAME);
  await removeDirectory(resolve(generatedRoot, mode));
  await removeGeneratedRootWhenEmpty(generatedRoot);
}

export async function cleanNextMode(mode, projectRoot = process.cwd(), instanceId = null) {
  const definition = modeDefinition(mode, instanceId);
  await removeDirectory(resolve(projectRoot, definition.distDirName));
  const generatedRoot = resolve(projectRoot, GENERATED_NEXT_ROOT_NAME);
  await removeDirectory(resolve(generatedRoot, definition.generatedModeName));
  await removeGeneratedRootWhenEmpty(generatedRoot);
}

export async function cleanAllNextGeneratedOutput(projectRoot = process.cwd()) {
  const removed = [
    resolve(projectRoot, DEVELOPMENT_DIST_DIR_NAME),
    resolve(projectRoot, TYPECHECK_DIST_DIR_NAME),
    resolve(projectRoot, RUNTIME_SMOKE_DIST_DIR_NAME),
    resolve(projectRoot, PRODUCTION_DIST_DIR_NAME),
    resolve(projectRoot, GENERATED_NEXT_ROOT_NAME)
  ];

  for (const path of removed) await removeDirectory(path);
  return removed;
}

export async function verifyNextGeneratedFiles(projectRoot = process.cwd()) {
  await stat(resolve(projectRoot, "next-env.d.ts"));
}