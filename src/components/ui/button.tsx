type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "default" | "small";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

export function Button({
  variant = "primary",
  size = "default",
  fullWidth = false,
  className = "",
  type = "button",
  ...props
}: ButtonProps): React.JSX.Element {
  const classes = [
    "ds-button",
    `ds-button-${variant}`,
    size === "small" ? "ds-button-small" : "",
    fullWidth ? "ds-button-full" : "",
    className
  ].filter(Boolean).join(" ");

  return <button className={classes} type={type} {...props} />;
}
