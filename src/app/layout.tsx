import type { Metadata } from "next";
import Script from "next/script";
import { headers } from "next/headers";

import { FORM_HISTORY_TRACKING_SCRIPT } from "@/components/ui/form-history-tracking";

import "@/app/globals.css";
import "@/app/design-system.css";
import "@/app/layout-containment.css";
import "@/app/profile.css";
import "@/app/design-system-integrations.css";
import "@/app/company-scope-demonstration.css";
import "@/app/notification-foundation.css";

// Per-request CSP nonces cannot be attached to prerendered HTML.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "HSE Verify",
    template: "%s | HSE Verify"
  },
  description: "Independent workforce competency assurance and verification.",
  robots: {
    index: false,
    follow: false
  }
};

export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  // Next.js injects this request nonce into its server-rendered scripts. Bind
  // the same nonce to this beforeInteractive client Script to avoid the React
  // hydration mismatch otherwise seen during development/browser workflows.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en">
      <body>
        <Script id="hse-form-history" strategy="beforeInteractive" nonce={nonce}>{FORM_HISTORY_TRACKING_SCRIPT}</Script>
        {children}
      </body>
    </html>
  );
}
