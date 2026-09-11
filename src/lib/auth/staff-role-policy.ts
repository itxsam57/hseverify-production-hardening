import type { AuthRole } from "@/lib/auth/auth-domain";
import type { StaffRole } from "@/lib/auth/staff-provisioning-service";

export function allowedStaffRolesForPortal(
  portalRole: AuthRole
): StaffRole[] {
  return portalRole === "root"
    ? ["company", "assessor", "verifier", "admin", "root"]
    : portalRole === "admin"
      ? ["company", "assessor", "verifier"]
      : [];
}
