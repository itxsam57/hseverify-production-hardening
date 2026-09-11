import "server-only";

import { resolve } from "node:path";

import {
  LocalTestPrivateObjectStorage,
  type PrivateObjectStorage
} from "./private-object-storage-core";

export {
  PrivateObjectConflictError,
  PrivateObjectStorageError,
  type PrivateObjectStat,
  type PrivateObjectStorage
} from "./private-object-storage-core";

export function createLocalTestPrivateObjectStorage(
  appEnvironment: "development" | "test"
): PrivateObjectStorage {
  const trustedBasePath = process.cwd();
  return new LocalTestPrivateObjectStorage({
    appEnvironment,
    trustedBasePath,
    rootPath: resolve(trustedBasePath, ".data", "private-objects")
  });
}
