"use client";

import { type ColumnDef } from "@tanstack/react-table";

import { OperationBadge } from "@/components/badges";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { miles as fmtMiles, money } from "@/lib/format";
import type { DriverPeriodTripRow } from "@/lib/queries/trips";

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function dowOf(iso: string) {
  return DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

type DayGroup = { date: string; legs: DriverPeriodTripRow[]; miles: number; pay: number };

/**
 * Drill-down ledger for one driver's period. Uses the shared shell's
 * hand-rendered tbody mode: day subtotal rows (matrix-sub) and the week
 * total (matrix-total) interleave with data rows via colSpan - not
 * expressible as a plain TanStack row model.
 */
export function PayrollLegsTable({
  days,
  totalMiles,
  totalPay
}: {
  days: DayGroup[];
  totalMiles: string;
  totalPay: string;
}) {
  const columns: ColumnDef<DayGroup, unknown>[] = [
    { id: "date", header: "日期", size: 110, enableResizing: false },
    { id: "operation", header: "操作", size: 96 },
    { id: "load", header: "Load#", size: 110 },
    { id: "route", header: "起点 → 终点", size: 220 },
    { id: "miles", header: "Miles", size: 80, meta: { headerClass: "num" } },
    { id: "pay", header: "本趟工资", size: 104, meta: { headerClass: "num" } }
  ];

  const table = useRosterTable({ data: [], columns, storageKey: "payops.payroll.legs.cols" });

  return (
    <RosterTable table={table}>
      <tbody>
        {days.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="empty">
              本周期没有行程记录。
            </td>
          </tr>
        )}
        {days.flatMap(day => [
          ...day.legs.map(leg => (
            <tr key={leg.id}>
              <td className="mono">
                {day.date.slice(5).replace("-", "/")}
                <span className="muted-inline">周{dowOf(day.date)}</span>
              </td>
              <td><OperationBadge operation={leg.operation} /></td>
              <td className="mono">{leg.load_no || "—"}</td>
              <td className="mono">
                {leg.from_code ?? "—"} <span className="route-arrow">→</span> {leg.to_code ?? "—"}
              </td>
              <td className="num">{fmtMiles(leg.miles)}</td>
              <td className="num">{money(leg.pay_amount)}</td>
            </tr>
          )),
          <tr key={`sub-${day.date}`} className="matrix-sub">
            <td colSpan={4}>
              小计 · {day.date.slice(5).replace("-", "/")} 周{dowOf(day.date)}
            </td>
            <td className="num">{fmtMiles(day.miles)}</td>
            <td className="num">{money(day.pay)}</td>
          </tr>
        ])}
        {days.length > 1 && (
          <tr className="matrix-total">
            <td colSpan={4}>周合计 · {days.length} 天</td>
            <td className="num">{fmtMiles(totalMiles)}</td>
            <td className="num">{money(totalPay)}</td>
          </tr>
        )}
      </tbody>
    </RosterTable>
  );
}
