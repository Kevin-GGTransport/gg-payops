import type { ReactNode } from "react";

export function LedgerPanel({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      {label ? <div className="panel-cap">{label}</div> : null}
      <div className="table-wrap">{children}</div>
    </div>
  );
}

export function LedgerEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty">{children}</td>
    </tr>
  );
}
