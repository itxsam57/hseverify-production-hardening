export function DataTable({
  caption,
  children
}: {
  caption: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="ds-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="ds-table">
        <caption>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function DataTableHead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <thead>{children}</thead>;
}

export function DataTableBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <tbody>{children}</tbody>;
}

export function DataTableRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <tr>{children}</tr>;
}

export function DataTableHeader({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <th scope="col">{children}</th>;
}

export function DataTableCell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <td>{children}</td>;
}
