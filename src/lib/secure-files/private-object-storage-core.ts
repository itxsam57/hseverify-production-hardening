import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type PrivateObjectStat = Readonly<{
  byteSize: number;
  sha256: string;
}>;

export interface PrivateObjectStorage {
  put(objectKey: string, bytes: Uint8Array): Promise<PrivateObjectStat>;
  read(objectKey: string): Promise<Uint8Array | null>;
  stat(objectKey: string): Promise<PrivateObjectStat | null>;
  delete(objectKey: string): Promise<boolean>;
}

export class PrivateObjectStorageError extends Error {
  constructor(message = "Private object storage operation failed.") {
    super(message);
    this.name = "PrivateObjectStorageError";
  }
}

export class PrivateObjectConflictError extends PrivateObjectStorageError {
  constructor() {
    super("Private object already exists with different content.");
    this.name = "PrivateObjectConflictError";
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeObjectKey(value: string): string {
  if (
    typeof value !== "string" ||
    !/^secure-files\/[a-f0-9]{64}$/.test(value)
  ) {
    throw new PrivateObjectStorageError("Private object key is invalid.");
  }
  return value;
}

function errnoCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : null;
}

function isInsideBase(base: string, target: string): boolean {
  const path = relative(base, target);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
  );
}

async function assertDirectoryWithoutSymlink(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new PrivateObjectStorageError(
      "Private storage directories must not be symbolic links."
    );
  }
}

async function ensureDirectoryPathWithoutSymlink(
  base: string,
  target: string
): Promise<void> {
  const relativePath = relative(base, target);
  if (
    relativePath === "" ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new PrivateObjectStorageError(
      "Private storage path escaped its trusted server base."
    );
  }

  await assertDirectoryWithoutSymlink(base);
  let current = base;
  for (const segment of relativePath.split(sep)) {
    current = resolve(current, segment);
    try {
      await assertDirectoryWithoutSymlink(current);
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (createError) {
        if (errnoCode(createError) !== "EEXIST") {
          throw new PrivateObjectStorageError();
        }
      }
      await assertDirectoryWithoutSymlink(current);
    }
  }
}

async function readRegularObject(path: string): Promise<Uint8Array | null> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new PrivateObjectStorageError(
        "Private object must be a regular non-symlink file."
      );
    }
    return await readFile(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    if (error instanceof PrivateObjectStorageError) throw error;
    throw new PrivateObjectStorageError();
  }
}

export class LocalTestPrivateObjectStorage implements PrivateObjectStorage {
  private readonly base: string;
  private readonly root: string;

  constructor(input: {
    appEnvironment: "development" | "test";
    trustedBasePath: string;
    rootPath: string;
  }) {
    if (
      input.appEnvironment !== "development" &&
      input.appEnvironment !== "test"
    ) {
      throw new PrivateObjectStorageError(
        "Local/test private object storage is not permitted in this environment."
      );
    }
    if (
      typeof input.trustedBasePath !== "string" ||
      input.trustedBasePath.trim().length === 0 ||
      typeof input.rootPath !== "string" ||
      input.rootPath.trim().length === 0
    ) {
      throw new PrivateObjectStorageError("Private storage root is invalid.");
    }
    const base = resolve(input.trustedBasePath);
    const root = resolve(input.rootPath);
    if (!isInsideBase(base, root) || root === base) {
      throw new PrivateObjectStorageError(
        "Private storage root must remain inside its trusted server base."
      );
    }
    this.base = base;
    this.root = root;
  }

  private async objectPath(objectKeyInput: string): Promise<string> {
    const objectKey = normalizeObjectKey(objectKeyInput);
    await ensureDirectoryPathWithoutSymlink(this.base, this.root);

    const realBase = await realpath(this.base);
    const realRoot = await realpath(this.root);
    if (!isInsideBase(realBase, realRoot) || realRoot === realBase) {
      throw new PrivateObjectStorageError(
        "Private storage root resolved outside its trusted server base."
      );
    }

    const objectDirectory = resolve(this.root, "secure-files");
    await ensureDirectoryPathWithoutSymlink(this.root, objectDirectory);
    const realObjectDirectory = await realpath(objectDirectory);
    if (!isInsideBase(realRoot, realObjectDirectory)) {
      throw new PrivateObjectStorageError(
        "Private object directory resolved outside its storage root."
      );
    }

    const objectHash = objectKey.slice("secure-files/".length);
    const target = resolve(objectDirectory, objectHash);
    if (!isInsideBase(realObjectDirectory, target) || target === realObjectDirectory) {
      throw new PrivateObjectStorageError("Private object path escaped its root.");
    }
    return target;
  }

  async put(objectKey: string, bytes: Uint8Array): Promise<PrivateObjectStat> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
      throw new PrivateObjectStorageError("Private object content is empty.");
    }
    const path = await this.objectPath(objectKey);
    const expected = Object.freeze({
      byteSize: bytes.byteLength,
      sha256: sha256(bytes)
    });
    try {
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      return expected;
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") {
        throw new PrivateObjectStorageError();
      }
      const existing = await readRegularObject(path);
      if (
        !existing ||
        existing.byteLength !== expected.byteSize ||
        sha256(existing) !== expected.sha256
      ) {
        throw new PrivateObjectConflictError();
      }
      return expected;
    }
  }

  async read(objectKey: string): Promise<Uint8Array | null> {
    const path = await this.objectPath(objectKey);
    return readRegularObject(path);
  }

  async stat(objectKey: string): Promise<PrivateObjectStat | null> {
    const path = await this.objectPath(objectKey);
    const bytes = await readRegularObject(path);
    if (!bytes) return null;
    return Object.freeze({
      byteSize: bytes.byteLength,
      sha256: sha256(bytes)
    });
  }

  async delete(objectKey: string): Promise<boolean> {
    const path = await this.objectPath(objectKey);
    const existing = await readRegularObject(path);
    if (!existing) return false;
    try {
      await rm(path, { force: false });
      return true;
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return false;
      throw new PrivateObjectStorageError();
    }
  }
}
