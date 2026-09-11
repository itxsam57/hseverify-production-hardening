export type StatusTone = "neutral" | "positive" | "warning" | "critical";

export function StatusBadge({
  label,
  tone = "neutral"
}: {
  label: string;
  tone?: StatusTone;
}): React.JSX.Element {
  return <span className={`ds-badge ds-badge-${tone}`}>{label}</span>;
}
