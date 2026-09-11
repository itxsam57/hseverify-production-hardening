import type * as Path from "node:path";

export type PGlitePathOptions = {
  cwd?: string;
  pathApi?: Pick<typeof Path, "isAbsolute" | "normalize" | "resolve">;
};

export function normalizePgliteDataDirectory(
  configuredValue: string,
  options?: PGlitePathOptions
): string;

export function ensurePgliteDataDirectoryParent(
  dataDirectory: string
): Promise<void>;
