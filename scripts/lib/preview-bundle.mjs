import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const PGLITE_PACKAGE_NAME = "@electric-sql/pglite";

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function removePreviewBundle(bundleRoot) {
  await rm(bundleRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

export async function copyTreePortable(source, destination) {
  const sourceStats = await stat(source);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Preview copy source is not a directory: ${source}`);
  }

  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
    preserveTimestamps: false
  });
}

async function findSymbolicLinks(root) {
  const links = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      const entryStats = await lstat(entryPath);
      if (entryStats.isSymbolicLink()) {
        links.push(entryPath);
        continue;
      }
      if (entryStats.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }

  return links;
}

async function findPgliteManifest(root) {
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (entry.name !== "package.json") {
        continue;
      }

      const normalized = entryPath.split(sep).join("/");
      if (!normalized.includes("/@electric-sql/")) {
        continue;
      }

      try {
        const manifest = JSON.parse(await readFile(entryPath, "utf8"));
        if (manifest.name === PGLITE_PACKAGE_NAME) {
          return entryPath;
        }
      } catch {
        // A malformed unrelated manifest is handled by the application build;
        // continue looking for the traced PGlite package.
      }
    }
  }

  return null;
}

export async function verifyPortablePreviewBundle(bundleRoot) {
  await stat(resolve(bundleRoot, "server.js"));
  await stat(resolve(bundleRoot, ".next", "static"));

  const links = await findSymbolicLinks(bundleRoot);
  if (links.length > 0) {
    throw new Error(
      `Preview bundle contains symbolic links and is not portable: ${links
        .slice(0, 5)
        .join(", ")}`
    );
  }

  const pgliteManifest = await findPgliteManifest(bundleRoot);
  if (!pgliteManifest) {
    throw new Error("Preview bundle does not contain the traced @electric-sql/pglite package.");
  }

  return { pgliteManifest };
}

export async function buildPortablePreviewBundle({
  projectRoot = process.cwd(),
  sourceRoot = resolve(projectRoot, ".next", "standalone"),
  bundleRoot = resolve(projectRoot, ".preview-bundle")
} = {}) {
  await stat(resolve(sourceRoot, "server.js"));
  await removePreviewBundle(bundleRoot);

  try {
    await copyTreePortable(sourceRoot, bundleRoot);
    await mkdir(resolve(bundleRoot, ".next"), { recursive: true });
    await copyTreePortable(
      resolve(projectRoot, ".next", "static"),
      resolve(bundleRoot, ".next", "static")
    );

    const publicRoot = resolve(projectRoot, "public");
    if (await pathExists(publicRoot)) {
      await copyTreePortable(publicRoot, resolve(bundleRoot, "public"));
    }

    const verification = await verifyPortablePreviewBundle(bundleRoot);
    return { bundleRoot, ...verification };
  } catch (error) {
    await removePreviewBundle(bundleRoot);
    throw error;
  }
}
