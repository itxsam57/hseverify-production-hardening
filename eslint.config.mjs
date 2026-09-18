import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".next-development/**",
    ".next-development-*/**",
    ".next-typecheck/**",
    ".next-runtime-smoke/**",
    ".hse-next/**",
    ".preview-bundle/**",
    ".auth-test-dist/**",
    ".worker-evidence-runtime-test-dist/**",
    ".billing-runtime-test-dist/**",
    ".company-organization-team-runtime-test-dist/**",
    ".production-launch-runtime-test-dist/**",
    ".profile-test-dist/**",
    ".secure-file-*/**",
    ".secure-scan-*/**",
    ".secure-upload-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts"
  ])
]);
