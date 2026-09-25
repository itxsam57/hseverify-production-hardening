import "server-only";

import { dirname, resolve } from "node:path";

import {
  FilesystemPrivateObjectStorage,
  LocalTestPrivateObjectStorage,
  PrivateObjectStorageError,
  type PrivateObjectStorage
} from "./private-object-storage-core";

export {
  PrivateObjectConflictError,
  PrivateObjectStorageError,
  FilesystemPrivateObjectStorage,
  type PrivateObjectStat,
  type PrivateObjectStorage
} from "./private-object-storage-core";

function runtimeProjectRoot(): string {
  const configuredRoot = process.env.HSE_RUNTIME_PROJECT_ROOT?.trim();
  return configuredRoot ? resolve(configuredRoot) : process.cwd();
}

export function createLocalTestPrivateObjectStorage(
  appEnvironment: "development" | "test"
): PrivateObjectStorage {
  const trustedBasePath = runtimeProjectRoot();
  return new LocalTestPrivateObjectStorage({
    appEnvironment,
    trustedBasePath,
    rootPath: resolve(trustedBasePath, ".data", "private-objects")
  });
}

export function createRuntimePrivateObjectStorage(
  appEnvironment: "development" | "test" | "preview" | "production"
): PrivateObjectStorage {
  if (appEnvironment === "development" || appEnvironment === "test") {
    return createLocalTestPrivateObjectStorage(appEnvironment);
  }

  const configuredRoot = process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT?.trim();
  if (!configuredRoot) {
    throw new PrivateObjectStorageError(
      "HSE_PRIVATE_OBJECT_STORAGE_ROOT is required for preview and production filesystem storage."
    );
  }

  const rootPath = resolve(configuredRoot);
  const trustedBasePath = dirname(rootPath);
  if (trustedBasePath === rootPath) {
    throw new PrivateObjectStorageError(
      "Private object storage root must be a dedicated directory."
    );
  }

  return new FilesystemPrivateObjectStorage({
    trustedBasePath,
    rootPath
  });
}
