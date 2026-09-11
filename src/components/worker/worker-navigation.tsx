"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/worker/dashboard", label: "Dashboard", icon: "⌂" },
  { href: "/worker/profile", label: "My profile", icon: "◎" },
  { href: "/worker/identity", label: "Identity", icon: "◇" },
  { href: "/worker/evidence", label: "Evidence", icon: "▤" },
  { href: "/worker/available-assessments", label: "Available assessments", icon: "▦" },
  { href: "/worker/company-access", label: "Company access", icon: "↔" },
  { href: "/worker/notifications", label: "Notifications", icon: "♢" }
] as const;

export function WorkerNavigation(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav className="portal-nav">
      <p className="nav-section-label">Workspace</p>
      {links.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            className={`nav-link${active ? " nav-link-active" : ""}`}
            href={link.href}
            aria-current={active ? "page" : undefined}
            key={link.href}
          >
            <span className="nav-icon" aria-hidden="true">{link.icon}</span>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
