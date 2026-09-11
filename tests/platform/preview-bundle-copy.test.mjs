import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildPortablePreviewBundle } from "../../scripts/lib/preview-bundle.mjs";

test("preview bundle materializes traced packages without destination symlinks", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "hse-preview-bundle-"));
  const projectRoot = join(testRoot, "project");
  const standaloneRoot = join(projectRoot, ".next", "standalone");
  const staticRoot = join(projectRoot, ".next", "static");
  const packageRoot = join(projectRoot, "node_modules", "@electric-sql", "pglite");
  const tracedPackageRoot = join(
    standaloneRoot,
    ".next",
    "node_modules",
    "@electric-sql",
    "pglite-testhash"
  );
  const bundleRoot = join(projectRoot, ".preview-bundle");

  try {
    await mkdir(standaloneRoot, { recursive: true });
    await mkdir(staticRoot, { recursive: true });
    await mkdir(packageRoot, { recursive: true });
    await mkdir(join(projectRoot, "public"), { recursive: true });
    await mkdir(resolve(tracedPackageRoot, ".."), { recursive: true });

    await writeFile(join(standaloneRoot, "server.js"), "console.log('preview fixture');\n");
    await writeFile(join(staticRoot, "app.css"), "body { color: black; }\n");
    await writeFile(join(projectRoot, "public", "health.txt"), "ok\n");
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "@electric-sql/pglite", version: "0.5.4" })
    );
    await writeFile(join(packageRoot, "index.js"), "export const fixture = true;\n");

    await symlink(
      packageRoot,
      tracedPackageRoot,
      process.platform === "win32" ? "junction" : "dir"
    );

    await mkdir(bundleRoot, { recursive: true });
    await writeFile(join(bundleRoot, "incomplete.txt"), "must be removed\n");

    const result = await buildPortablePreviewBundle({ projectRoot });

    assert.equal(result.bundleRoot, bundleRoot);
    assert.equal(
      await readFile(join(bundleRoot, ".next", "static", "app.css"), "utf8"),
      "body { color: black; }\n"
    );
    assert.equal(await readFile(join(bundleRoot, "public", "health.txt"), "utf8"), "ok\n");
    assert.equal(
      await readFile(join(bundleRoot, ".next", "node_modules", "@electric-sql", "pglite-testhash", "index.js"), "utf8"),
      "export const fixture = true;\n"
    );

    const copiedPackageStats = await lstat(
      join(bundleRoot, ".next", "node_modules", "@electric-sql", "pglite-testhash")
    );
    assert.equal(copiedPackageStats.isSymbolicLink(), false);

    await assert.rejects(readFile(join(bundleRoot, "incomplete.txt"), "utf8"), {
      code: "ENOENT"
    });

    await writeFile(join(bundleRoot, "second-incomplete.txt"), "remove me too\n");
    await buildPortablePreviewBundle({ projectRoot });
    await assert.rejects(readFile(join(bundleRoot, "second-incomplete.txt"), "utf8"), {
      code: "ENOENT"
    });
  } finally {
    await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
