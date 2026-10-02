"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AuthRole } from "@/lib/auth/auth-domain";

type NavigationItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: string;
};

const ROLE_LINKS: Record<Exclude<AuthRole, "worker">, readonly NavigationItem[]> = {
  company: [
    { href: "/company/dashboard", label: "Dashboard", icon: "⌂" },
    { href: "/company/settings/profile", label: "Company profile", icon: "◎" },
    { href: "/company/organization", label: "Sites & departments", icon: "◇" },
    { href: "/company/tenant-scope", label: "Tenant scope", icon: "◫" },
    { href: "/company/team", label: "Company Team", icon: "♟" },
    { href: "/company/invitations", label: "Worker invitations", icon: "↗" },
    { href: "/company/workers", label: "Workforce directory", icon: "♙" },
    { href: "/company/observations", label: "Supervisor observations", icon: "✎" },
    { href: "/company/assurance-orders", label: "Assurance Orders", icon: "▤" },
    { href: "/company/action-centre", label: "Action Centre", icon: "⚑" },
    { href: "/company/reports", label: "Reports", icon: "▣" },
    { href: "/company/audit", label: "Company audit", icon: "◫" },
    { href: "/company/settings/policy", label: "Effective policy", icon: "⚙" },
    { href: "/company/billing", label: "Billing", icon: "¤" },
    { href: "/company/notifications", label: "Notifications", icon: "♢" }
  ],
  assessor: [
    { href: "/assessor/dashboard", label: "Dashboard", icon: "⌂" },
    { href: "/assessor/interviews", label: "Interview assignments", icon: "◉" },
    { href: "/assessor/calibration", label: "Calibration", icon: "✓" },
    { href: "/assessor/notifications", label: "Notifications", icon: "♢" }
  ],
  verifier: [
    { href: "/verifier/dashboard", label: "Dashboard", icon: "⌂" },
    { href: "/verifier/reviews", label: "Evidence reviews", icon: "▤" },
    { href: "/verifier/reviews/scoring", label: "Written scoring", icon: "✎" },
    { href: "/verifier/assessment-recovery", label: "Assessment recovery", icon: "↻" },
    { href: "/verifier/calibration", label: "Calibration", icon: "✓" },
    { href: "/verifier/notifications", label: "Notifications", icon: "♢" }
  ],
  admin: [
    { href: "/admin/dashboard", label: "Dashboard", icon: "⌂" },
    { href: "/admin/company-verifications", label: "Company verifications", icon: "✓" },
    { href: "/admin/frameworks", label: "Frameworks & policy", icon: "◇" },
    { href: "/admin/question-bank", label: "Question Bank", icon: "?" },
    { href: "/admin/assessment-blueprints", label: "Assessment blueprints", icon: "▦" },
    { href: "/admin/assessment-catalogue", label: "Assessment catalogue", icon: "▤" },
    { href: "/admin/decisions", label: "Decision Engine", icon: "⚖" },
    { href: "/admin/calibrations", label: "Staff calibration", icon: "✓" },
    { href: "/admin/assessor-matching", label: "Assessor matching", icon: "↔" },
    { href: "/admin/certifications", label: "Certifications", icon: "◆" },
    { href: "/admin/appeals", label: "Credential appeals", icon: "⚖" },
    { href: "/admin/operations", label: "Operations & health", icon: "⚙" },
    { href: "/admin/privacy", label: "Privacy & accommodations", icon: "◉" },
    { href: "/admin/case-replay", label: "Case Replay", icon: "↺" },
    { href: "/admin/staff", label: "Staff invitations", icon: "♟" },
    { href: "/admin/notifications", label: "Notifications", icon: "♢" }
  ],
  root: [
    { href: "/root/dashboard", label: "Dashboard", icon: "⌂" },
    { href: "/root/staff", label: "Staff & access", icon: "♟" },
    { href: "/root/notifications", label: "Notifications", icon: "♢" }
  ]
};

export function RoleNavigation({
  role
}: {
  role: Exclude<AuthRole, "worker">;
}): React.JSX.Element {
  const pathname = usePathname();
  const links = ROLE_LINKS[role];

  return (
    <nav className="portal-nav" aria-label="Portal workspace">
      <p className="nav-section-label">Workspace</p>
      {links.map((link) => {
        const active =
          pathname === link.href ||
          (link.href !== `/${role}/dashboard` && pathname.startsWith(`${link.href}/`));
        return (
          <Link
            className={`nav-link${active ? " nav-link-active" : ""}`}
            href={link.href}
            aria-current={active ? "page" : undefined}
            key={link.href}
          >
            <span className="nav-icon" aria-hidden="true">{link.icon}</span>
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}