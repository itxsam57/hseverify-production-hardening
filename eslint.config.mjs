import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".next-development/**",
    ".next-typecheck/**",
    ".next-runtime-smoke/**",
    ".hse-next/**",
    ".preview-bundle/**",
    ".auth-test-dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts"
  ])
]);
