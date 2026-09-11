import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const storageModule = await import(
  "../../.secure-file-test-dist/secure-files/private-object-storage-core.js"
);

function objectKey(character) {
  return `secure-files/${character.repeat(64)}`;
}

function errorCode(error) {
  return error && typeof error === "object" && "code" in error
    ? error.code
    : null;
}

async function createDirectorySymlink(target, path) {
  await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
}

test("local private storage writes, reads, stats and deletes one exact opaque object", async () => {
  const base = await mkdtemp(join(tmpdir(), "hse-secure-storage-"));
  const root = join(base, "objects");
  try {
    const storage = new storageModule.LocalTestPrivateObjectStorage({
      appEnvironment: "test",
      trustedBasePath: base,
      rootPath: root
    });
    const bytes = new TextEncoder().encode("private fixture bytes");
    const key = objectKey("a");
    const written = await storage.put(key, bytes);
    assert.equal(written.byteSize, bytes.byteLength);
    assert.match(written.sha256, /^[a-f0-9]{64}$/);

    const read = await storage.read(key);
    assert.deepEqual([...read], [...bytes]);
    assert.deepEqual(await storage.stat(key), written);
    assert.equal(await storage.delete(key), true);
    assert.equal(await storage.read(key), null);
    assert.equal(await storage.stat(key), null);
    assert.equal(await storage.delete(key), false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("identical retry is idempotent while different bytes cannot replace an existing object", async () => {
  const base = await mkdtemp(join(tmpdir(), "hse-secure-storage-idempotent-"));
  try {
    const storage = new storageModule.LocalTestPrivateObjectStorage({
      appEnvironment: "development",
      trustedBasePath: base,
      rootPath: join(base, "objects")
    });
    const key = objectKey("b");
    const first = new TextEncoder().encode("same bytes");
    assert.deepEqual(await storage.put(key, first), await storage.put(key, first));
    await assert.rejects(
      storage.put(key, new TextEncoder().encode("different bytes")),
      storageModule.PrivateObjectConflictError
    );
    assert.deepEqual([...(await storage.read(key))], [...first]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("object keys cannot carry absolute paths, traversal, filenames or alternate roots", async () => {
  const base = await mkdtemp(join(tmpdir(), "hse-secure-storage-boundary-"));
  try {
    const storage = new storageModule.LocalTestPrivateObjectStorage({
      appEnvironment: "test",
      trustedBasePath: base,
      rootPath: join(base, "objects")
    });
    const bytes = new Uint8Array([1]);
    for (const key of [
      "../outside",
      "secure-files/../outside",
      "/tmp/secure-files/" + "c".repeat(64),
      "C:\\temp\\secure-files\\" + "c".repeat(64),
      "secure-files/passport.pdf",
      "secure-files/" + "g".repeat(64)
    ]) {
      await assert.rejects(storage.put(key, bytes), storageModule.PrivateObjectStorageError);
    }
    assert.throws(
      () => new storageModule.LocalTestPrivateObjectStorage({
        appEnvironment: "test",
        trustedBasePath: join(base, "trusted"),
        rootPath: join(base, "outside")
      }),
      storageModule.PrivateObjectStorageError
    );
    assert.throws(
      () => new storageModule.LocalTestPrivateObjectStorage({
        appEnvironment: "production",
        trustedBasePath: base,
        rootPath: join(base, "objects")
      }),
      storageModule.PrivateObjectStorageError
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("storage rejects symbolic-link directory escapes before creating outside paths", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "hse-secure-storage-symlink-"));
  try {
    const outside = join(base, "outside");
    const link = join(base, "linked-root");
    await mkdir(outside, { recursive: true });
    try {
      await createDirectorySymlink(outside, link);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(errorCode(error))) {
        t.skip("This platform does not permit creating a test directory symlink.");
        return;
      }
      throw error;
    }

    const linkedStorage = new storageModule.LocalTestPrivateObjectStorage({
      appEnvironment: "test",
      trustedBasePath: base,
      rootPath: join(link, "private-objects")
    });
    await assert.rejects(
      linkedStorage.put(objectKey("c"), new Uint8Array([1, 2, 3])),
      storageModule.PrivateObjectStorageError
    );
    await assert.rejects(
      lstat(join(outside, "private-objects")),
      (error) => errorCode(error) === "ENOENT"
    );

    const root = join(base, "objects");
    const outsideObjects = join(outside, "object-target");
    await mkdir(root, { recursive: true });
    await mkdir(outsideObjects, { recursive: true });
    await createDirectorySymlink(outsideObjects, join(root, "secure-files"));
    const objectDirectoryEscape = new storageModule.LocalTestPrivateObjectStorage({
      appEnvironment: "test",
      trustedBasePath: base,
      rootPath: root
    });
    await assert.rejects(
      objectDirectoryEscape.put(objectKey("d"), new Uint8Array([4, 5, 6])),
      storageModule.PrivateObjectStorageError
    );
    assert.deepEqual(await lstat(outsideObjects).then((entry) => entry.isDirectory()), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("empty content is rejected by the storage primitive", async () => {
  const base = await mkdtemp(join(tmpdir(), "hse-secure-storage-empty-"));
  try {
    const storage = new storageModule.LocalTestPrivateObjectStorage({
      appEnvironment: "test",
      trustedBasePath: base,
      rootPath: join(base, "objects")
    });
    await assert.rejects(
      storage.put(objectKey("e"), new Uint8Array()),
      storageModule.PrivateObjectStorageError
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
