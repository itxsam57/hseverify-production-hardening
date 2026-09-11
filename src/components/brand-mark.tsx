import Link from "next/link";

export function BrandMark({
  light = false
}: {
  light?: boolean;
}): React.JSX.Element {
  return (
    <Link
      aria-label="HSE Verify home"
      className={`brand-mark${light ? " brand-mark-light" : ""}`}
      href="/"
    >
      <span aria-hidden="true" className="brand-symbol">
        HV
      </span>
      <span>HSE Verify</span>
    </Link>
  );
}
