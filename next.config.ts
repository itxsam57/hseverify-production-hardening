import type { NextConfig } from "next";

type NextCommandMode =
  | "default"
  | "development"
  | "typegen"
  | "runtime-smoke"
  | "production-build";

const requestedMode = process.env.HSE_NEXT_COMMAND_MODE?.trim() || "default";
const supportedModes = new Set<NextCommandMode>([
  "default",
  "development",
  "typegen",
  "runtime-smoke",
  "production-build"
]);

if (!supportedModes.has(requestedMode as NextCommandMode)) {
  throw new Error(
    "HSE_NEXT_COMMAND_MODE must be default, development, typegen, runtime-smoke or production-build."
  );
}

const commandMode = requestedMode as NextCommandMode;

const commandBoundary: Partial<NextConfig> =
  commandMode === "development"
    ? {
        distDir: ".next-development",
        typescript: {
          tsconfigPath: ".hse-next/development/tsconfig.json"
        }
      }
    : commandMode === "runtime-smoke"
      ? {
          distDir: ".next-runtime-smoke",
          typescript: {
            tsconfigPath: ".hse-next/runtime-smoke/tsconfig.json"
          }
        }
      : commandMode === "production-build"
        ? {
            typescript: {
              tsconfigPath: ".hse-next/production-build/tsconfig.json"
            }
          }
        : commandMode === "typegen"
          ? {
              distDir: ".next-typecheck",
              typescript: {
                tsconfigPath: ".hse-next/typecheck/tsconfig.json"
              }
            }
          : {};

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",
  deploymentId: process.env.HSE_DEPLOYMENT_ID || process.env.HSE_RELEASE_SHA,
  serverExternalPackages: ["@electric-sql/pglite"],
  ...commandBoundary,
  experimental: {
    serverActions: {
      // Identity evidence accepts at most 10 MiB at the application policy boundary.
      // Keep the framework envelope only slightly larger for multipart metadata while
      // remaining globally bounded; every identity upload is revalidated again by M1.06.
      bodySizeLimit: "11mb"
    }
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
