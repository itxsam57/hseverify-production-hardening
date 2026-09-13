"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalTestPrivateObjectStorage = exports.PrivateObjectConflictError = exports.PrivateObjectStorageError = void 0;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
class PrivateObjectStorageError extends Error {
    constructor(message = "Private object storage operation failed.") {
        super(message);
        this.name = "PrivateObjectStorageError";
    }
}
exports.PrivateObjectStorageError = PrivateObjectStorageError;
class PrivateObjectConflictError extends PrivateObjectStorageError {
    constructor() {
        super("Private object already exists with different content.");
        this.name = "PrivateObjectConflictError";
    }
}
exports.PrivateObjectConflictError = PrivateObjectConflictError;
function sha256(bytes) {
    return (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex");
}
function normalizeObjectKey(value) {
    if (typeof value !== "string" ||
        !/^secure-files\/[a-f0-9]{64}$/.test(value)) {
        throw new PrivateObjectStorageError("Private object key is invalid.");
    }
    return value;
}
function errnoCode(error) {
    if (!error || typeof error !== "object" || !("code" in error))
        return null;
    const value = error.code;
    return typeof value === "string" ? value : null;
}
function isInsideBase(base, target) {
    const path = (0, node_path_1.relative)(base, target);
    return (path === "" ||
        (!(0, node_path_1.isAbsolute)(path) && path !== ".." && !path.startsWith(`..${node_path_1.sep}`)));
}
async function assertDirectoryWithoutSymlink(path) {
    const metadata = await (0, promises_1.lstat)(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new PrivateObjectStorageError("Private storage directories must not be symbolic links.");
    }
}
async function ensureDirectoryPathWithoutSymlink(base, target) {
    const relativePath = (0, node_path_1.relative)(base, target);
    if (relativePath === "" ||
        (0, node_path_1.isAbsolute)(relativePath) ||
        relativePath === ".." ||
        relativePath.startsWith(`..${node_path_1.sep}`)) {
        throw new PrivateObjectStorageError("Private storage path escaped its trusted server base.");
    }
    await assertDirectoryWithoutSymlink(base);
    let current = base;
    for (const segment of relativePath.split(node_path_1.sep)) {
        current = (0, node_path_1.resolve)(current, segment);
        try {
            await assertDirectoryWithoutSymlink(current);
        }
        catch (error) {
            if (errnoCode(error) !== "ENOENT")
                throw error;
            try {
                await (0, promises_1.mkdir)(current, { mode: 0o700 });
            }
            catch (createError) {
                if (errnoCode(createError) !== "EEXIST") {
                    throw new PrivateObjectStorageError();
                }
            }
            await assertDirectoryWithoutSymlink(current);
        }
    }
}
async function readRegularObject(path) {
    try {
        const metadata = await (0, promises_1.lstat)(path);
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
            throw new PrivateObjectStorageError("Private object must be a regular non-symlink file.");
        }
        return await (0, promises_1.readFile)(path);
    }
    catch (error) {
        if (errnoCode(error) === "ENOENT")
            return null;
        if (error instanceof PrivateObjectStorageError)
            throw error;
        throw new PrivateObjectStorageError();
    }
}
class LocalTestPrivateObjectStorage {
    base;
    root;
    constructor(input) {
        if (input.appEnvironment !== "development" &&
            input.appEnvironment !== "test") {
            throw new PrivateObjectStorageError("Local/test private object storage is not permitted in this environment.");
        }
        if (typeof input.trustedBasePath !== "string" ||
            input.trustedBasePath.trim().length === 0 ||
            typeof input.rootPath !== "string" ||
            input.rootPath.trim().length === 0) {
            throw new PrivateObjectStorageError("Private storage root is invalid.");
        }
        const base = (0, node_path_1.resolve)(input.trustedBasePath);
        const root = (0, node_path_1.resolve)(input.rootPath);
        if (!isInsideBase(base, root) || root === base) {
            throw new PrivateObjectStorageError("Private storage root must remain inside its trusted server base.");
        }
        this.base = base;
        this.root = root;
    }
    async objectPath(objectKeyInput) {
        const objectKey = normalizeObjectKey(objectKeyInput);
        await ensureDirectoryPathWithoutSymlink(this.base, this.root);
        const realBase = await (0, promises_1.realpath)(this.base);
        const realRoot = await (0, promises_1.realpath)(this.root);
        if (!isInsideBase(realBase, realRoot) || realRoot === realBase) {
            throw new PrivateObjectStorageError("Private storage root resolved outside its trusted server base.");
        }
        const objectDirectory = (0, node_path_1.resolve)(this.root, "secure-files");
        await ensureDirectoryPathWithoutSymlink(this.root, objectDirectory);
        const realObjectDirectory = await (0, promises_1.realpath)(objectDirectory);
        if (!isInsideBase(realRoot, realObjectDirectory)) {
            throw new PrivateObjectStorageError("Private object directory resolved outside its storage root.");
        }
        const objectHash = objectKey.slice("secure-files/".length);
        const target = (0, node_path_1.resolve)(objectDirectory, objectHash);
        if (!isInsideBase(realObjectDirectory, target) || target === realObjectDirectory) {
            throw new PrivateObjectStorageError("Private object path escaped its root.");
        }
        return target;
    }
    async put(objectKey, bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
            throw new PrivateObjectStorageError("Private object content is empty.");
        }
        const path = await this.objectPath(objectKey);
        const expected = Object.freeze({
            byteSize: bytes.byteLength,
            sha256: sha256(bytes)
        });
        try {
            await (0, promises_1.writeFile)(path, bytes, { flag: "wx", mode: 0o600 });
            return expected;
        }
        catch (error) {
            if (errnoCode(error) !== "EEXIST") {
                throw new PrivateObjectStorageError();
            }
            const existing = await readRegularObject(path);
            if (!existing ||
                existing.byteLength !== expected.byteSize ||
                sha256(existing) !== expected.sha256) {
                throw new PrivateObjectConflictError();
            }
            return expected;
        }
    }
    async read(objectKey) {
        const path = await this.objectPath(objectKey);
        return readRegularObject(path);
    }
    async stat(objectKey) {
        const path = await this.objectPath(objectKey);
        const bytes = await readRegularObject(path);
        if (!bytes)
            return null;
        return Object.freeze({
            byteSize: bytes.byteLength,
            sha256: sha256(bytes)
        });
    }
    async delete(objectKey) {
        const path = await this.objectPath(objectKey);
        const existing = await readRegularObject(path);
        if (!existing)
            return false;
        try {
            await (0, promises_1.rm)(path, { force: false });
            return true;
        }
        catch (error) {
            if (errnoCode(error) === "ENOENT")
                return false;
            throw new PrivateObjectStorageError();
        }
    }
}
exports.LocalTestPrivateObjectStorage = LocalTestPrivateObjectStorage;
