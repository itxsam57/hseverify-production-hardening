import type { Metadata } from "next";

import "@/app/globals.css";
import "@/app/design-system.css";
import "@/app/layout-containment.css";
import "@/app/profile.css";
import "@/app/design-system-integrations.css";
import "@/app/company-scope-demonstration.css";
import "@/app/notification-foundation.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
