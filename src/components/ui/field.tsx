export function Field({
  label,
  htmlFor,
  optional = false,
  hint,
  error,
  children,
  className = ""
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className={`ds-field ${className}`.trim()}>
      <label className="ds-field-label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="ds-field-optional"> Optional</span> : null}
      </label>
      {children}
      {hint ? <span className="ds-field-hint" id={hintId}>{hint}</span> : null}
      {error ? <span className="ds-field-error" id={errorId} role="alert">{error}</span> : null}
    </div>
  );
}

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input className={`ds-input ${className}`.trim()} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select className={`ds-select ${className}`.trim()} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return <textarea className={`ds-textarea ${className}`.trim()} {...props} />;
}

export function CheckboxField({
  label,
  className = "",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
}): React.JSX.Element {
  return (
    <label className={`ds-checkbox-field ${className}`.trim()}>
      <input className="ds-checkbox" type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
