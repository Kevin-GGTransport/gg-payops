"use client";

import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";

import { OperationBadge, PackageBadge, RoutePair } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { fuel as fmtFuel, miles as fmtMiles, money } from "@/lib/format";
import type { DriverPeriodTripRow } from "@/lib/queries/trips";
import { deleteTrip } from "./actions";
import { TripEditDialog, type TripEditDictionaries } from "./trip-edit-dialog";

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function dowOf(iso: string) {
  return DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

type DayGroup = {
  date: string;
  legs: DriverPeriodTripRow[];
  miles: number;
  fuel: number;
  pay: number;
  subsidy: number;
};

/** Fuel subsidy cell: $0 (plain drivers, un-subsidized legs) reads as a dash */
function subsidyCell(value: string | number) {
  return Number(value) > 0 ? money(value) : "—";
}

/** Stable empty row set: a fresh [] per render churns TanStack's sizing sync */
const NO_ROWS: DayGroup[] = [];

/**
 * Drill-down ledger for one driver's period. Uses the shared shell's
 * hand-rendered tbody mode: day subtotal rows (matrix-sub) and the week
 * total (matrix-total) interleave with data rows via colSpan - not
 * expressible as a plain TanStack row model. When dictionaries arrive, each
 * leg also gets an in-page edit button opening the client-side dialog.
 */
export function PayrollLegsTable({
  days,
  totalMiles,
  totalFuel,
  totalPay,
  totalSubsidy = "0",
  /** Where the per-row delete/edit-save redirects back to (full path with ?period=) */
  returnTo,
  /** When set, each leg gets an edit button opening the local dialog */
  edit,
  storageKey = "payops.payroll.legs.cols"
}: {
  days: DayGroup[];
  totalMiles: string;
  totalFuel: string;
  totalPay: string;
  /** Owner fuel subsidy of the period (drivers pass nothing / "0") */
  totalSubsidy?: string;
  returnTo: string;
  edit?: TripEditDictionaries;
  storageKey?: string;
}) {
  // Local open state: clicking 编辑 opens instantly with the row's own data,
  // no navigation and no URL change
  const [editing, setEditing] = React.useState<DriverPeriodTripRow | null>(null);

  // Stable identities (memoized columns, constant empty data): a fresh array
  // per render churns TanStack's internal sizing-sync loop and burns the CPU
  const columns = React.useMemo<ColumnDef<DayGroup, unknown>[]>(
    () => [
      { id: "date", header: "日期", size: 110, enableResizing: false },
      { id: "operation", header: "操作", size: 96 },
      { id: "load", header: "Load#", size: 110 },
      { id: "route", header: "起点 → 终点", size: 220 },
      { id: "miles", header: "Miles", size: 80, meta: { headerClass: "num" } },
      { id: "fuel", header: "加油(gal)", size: 84, meta: { headerClass: "num" } },
      { id: "subsidy", header: "燃油补助", size: 84, meta: { headerClass: "num" } },
      { id: "pay", header: "本趟工资", size: 104, meta: { headerClass: "num" } },
      { id: "delete", header: "操作", size: edit ? 76 : 48, enableResizing: false, meta: { headerClass: "px-1.5" } }
    ],
    // edit prop identity is stable across client re-renders (server payload)
    [edit]
  );

  const table = useRosterTable({ data: NO_ROWS, columns, storageKey });

  return (
    <>
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
                  <RoutePair from={leg.from_code} to={leg.to_code} />
                </td>
                <td className="num">{fmtMiles(leg.miles)}</td>
                <td className="num">{fmtFuel(leg.fuel_gallons)}</td>
                <td className="num">{subsidyCell(leg.fuel_subsidy)}</td>
                <td className="num">
                  {money(leg.pay_amount)}
                  {leg.package_id && (
                    <>
                      {" "}
                      <PackageBadge note={leg.package_note} />
                    </>
                  )}
                </td>
                <td className="actions px-1.5">
                  {edit && (
                    <button type="button" className="linklike" onClick={() => setEditing(leg)}>
                      编辑
                    </button>
                  )}
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
              <td className="num">{subsidyCell(day.subsidy)}</td>
              <td className="num">{money(day.pay)}</td>
              <td />
            </tr>
          ])}
          {days.length > 1 && (
            <tr className="matrix-total">
              <td colSpan={4}>周合计 · {days.length} 天</td>
              <td className="num">{fmtMiles(totalMiles)}</td>
              <td className="num">{fmtFuel(totalFuel)}</td>
              <td className="num">{subsidyCell(totalSubsidy)}</td>
              <td className="num">{money(totalPay)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </RosterTable>
      {edit && (
        <TripEditDialog
          trip={editing}
          dictionaries={edit}
          onClose={() => setEditing(null)}
          returnTo={returnTo}
        />
      )}
    </>
  );
}
