import { StatusBadge as UiStatusBadge } from "@/components/ui/status-badge";
import type { DashboardTone } from "@/lib/worker/dashboard-types";

export function StatusBadge({
  label,
  tone = "neutral"
}: {
  label: string;
  tone?: DashboardTone;
}): React.JSX.Element {
  return <UiStatusBadge label={label} tone={tone} />;
}
