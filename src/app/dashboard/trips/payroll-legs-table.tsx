"use client";

import { type ColumnDef } from "@tanstack/react-table";

import { OperationBadge } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { fuel as fmtFuel, miles as fmtMiles, money } from "@/lib/format";
import type { DriverPeriodTripRow } from "@/lib/queries/trips";
import { deleteTrip } from "./actions";

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function dowOf(iso: string) {
  return DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

type DayGroup = { date: string; legs: DriverPeriodTripRow[]; miles: number; fuel: number; pay: number };

/**
 * Drill-down ledger for one driver's period. Uses the shared shell's
 * hand-rendered tbody mode: day subtotal rows (matrix-sub) and the week
 * total (matrix-total) interleave with data rows via colSpan - not
 * expressible as a plain TanStack row model.
 */
export function PayrollLegsTable({
  days,
  totalMiles,
  totalFuel,
  totalPay,
  /** Where the per-row delete redirects back to (query string or full path) */
  returnTo,
  storageKey = "payops.payroll.legs.cols"
}: {
  days: DayGroup[];
  totalMiles: string;
  totalFuel: string;
  totalPay: string;
  returnTo: string;
  storageKey?: string;
}) {
  const columns: ColumnDef<DayGroup, unknown>[] = [
    { id: "date", header: "日期", size: 110, enableResizing: false },
    { id: "operation", header: "操作", size: 96 },
    { id: "load", header: "Load#", size: 110 },
    { id: "route", header: "起点 → 终点", size: 220 },
    { id: "miles", header: "Miles", size: 80, meta: { headerClass: "num" } },
    { id: "fuel", header: "加油(gal)", size: 84, meta: { headerClass: "num" } },
    { id: "pay", header: "本趟工资", size: 104, meta: { headerClass: "num" } },
    { id: "delete", header: "删除", size: 48, enableResizing: false, meta: { headerClass: "px-1.5" } }
  ];

  const table = useRosterTable({ data: [], columns, storageKey });

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
              <td className="num">{fmtFuel(leg.fuel_gallons)}</td>
              <td className="num">{money(leg.pay_amount)}</td>
              <td className="actions px-1.5">
                <form action={deleteTrip}>
                  <input type="hidden" name="id" value={leg.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <ConfirmButton type="submit" className="linklike danger" message="删除这条行程？">
                    删除
                  </ConfirmButton>
                </form>
              </td>
            </tr>
          )),
          <tr key={`sub-${day.date}`} className="matrix-sub">
            <td colSpan={4}>
              小计 · {day.date.slice(5).replace("-", "/")} 周{dowOf(day.date)}
            </td>
            <td className="num">{fmtMiles(day.miles)}</td>
            <td className="num">{fmtFuel(day.fuel)}</td>
            <td className="num">{money(day.pay)}</td>
            <td />
          </tr>
        ])}
        {days.length > 1 && (
          <tr className="matrix-total">
            <td colSpan={4}>周合计 · {days.length} 天</td>
            <td className="num">{fmtMiles(totalMiles)}</td>
            <td className="num">{fmtFuel(totalFuel)}</td>
            <td className="num">{money(totalPay)}</td>
            <td />
          </tr>
        )}
      </tbody>
    </RosterTable>
  );
}
