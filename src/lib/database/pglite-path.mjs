import { mkdir } from "node:fs/promises";
import * as nativePath from "node:path";
import { fileURLToPath } from "node:url";

const URI_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;

/**
 * Convert configured PGlite storage into a native filesystem path string.
 *
 * PGlite accepts strings. Keeping this boundary explicit prevents URL objects
 * created by a bundler or another JavaScript realm from reaching Node's fs API.
 */
export function normalizePgliteDataDirectory(
  configuredValue,
  options = {}
) {
  if (typeof configuredValue !== "string") {
    throw new TypeError("HSE_PGLITE_DATA_DIR must be a string filesystem path.");
  }

  const value = configuredValue.trim();
  if (!value) {
    throw new TypeError("HSE_PGLITE_DATA_DIR must not be empty.");
  }

  if (value === "memory://") {
    return value;
  }

  const pathApi = options.pathApi ?? nativePath;
  const workingDirectory = options.cwd ?? process.cwd();

  if (/^file:\/\//i.test(value)) {
    const filesystemPath = fileURLToPath(value);
    return String(pathApi.resolve(filesystemPath));
  }

  if (URI_SCHEME.test(value)) {
    throw new TypeError(
      "HSE_PGLITE_DATA_DIR supports only a native filesystem path, file:// URL string, or memory://."
    );
  }

  const resolvedPath = pathApi.isAbsolute(value)
    ? pathApi.normalize(value)
    : pathApi.resolve(workingDirectory, value);

  return String(resolvedPath);
}

export async function ensurePgliteDataDirectoryParent(dataDirectory) {
  if (dataDirectory === "memory://") {
    return;
  }

  if (typeof dataDirectory !== "string") {
    throw new TypeError("PGlite data directory must remain a native path string.");
  }

  await mkdir(nativePath.dirname(dataDirectory), { recursive: true });
}
