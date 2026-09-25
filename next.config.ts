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
const requestedInstanceId = process.env.HSE_NEXT_INSTANCE_ID?.trim() || "";
if (requestedInstanceId && !/^[A-Za-z0-9_-]{1,80}$/.test(requestedInstanceId)) {
  throw new Error("HSE_NEXT_INSTANCE_ID is invalid.");
}
const developmentSuffix = requestedInstanceId ? `-${requestedInstanceId}` : "";

const commandBoundary: Partial<NextConfig> =
  commandMode === "development"
    ? {
        distDir: `.next-development${developmentSuffix}`,
        typescript: {
          tsconfigPath: `.hse-next/development${developmentSuffix}/tsconfig.json`
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

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  commandMode === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:"
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
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
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains"
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()"
          }
        ]
      }
    ];
  }
};

export default nextConfig;