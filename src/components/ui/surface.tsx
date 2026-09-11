export function Card({
  children,
  className = "",
  padded = true
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}): React.JSX.Element {
  return (
    <section className={`ds-card${padded ? " ds-card-padding" : ""} ${className}`.trim()}>
      {children}
    </section>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="page-heading-row">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-intro">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
