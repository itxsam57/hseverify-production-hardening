"use client";

export function CompanyWorkforcePrintButton(): React.JSX.Element {
  return <button className="button button-secondary" type="button" onClick={() => window.print()}>Print directory</button>;
}
