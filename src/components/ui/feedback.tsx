type AlertTone = "neutral" | "success" | "warning" | "danger";

export function Alert({
  tone = "neutral",
  children,
  className = "",
  role
}: {
  tone?: AlertTone;
  children: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
}): React.JSX.Element {
  const resolvedRole = role ?? (tone === "danger" ? "alert" : "status");
  return (
    <div className={`ds-alert ds-alert-${tone} ${className}`.trim()} role={resolvedRole}>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="ds-empty-state" aria-label={title}>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </section>
  );
}

export function LoadingState({
  label = "Loading",
  height = "8rem"
}: {
  label?: string;
  height?: string;
}): React.JSX.Element {
  return (
    <div aria-busy="true" aria-label={label} className="ds-skeleton" role="status" style={{ height }}>
      <span className="sr-only">{label}</span>
    </div>
  );
}
