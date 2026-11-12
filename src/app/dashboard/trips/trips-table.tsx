"use client";

import { type ColumnDef } from "@tanstack/react-table";

import { DriverTypeBadge, OperationBadge } from "@/components/badges";
import { SelectAll } from "@/components/select-all";
import { ConfirmButton } from "@/components/confirm-button";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { miles as fmtMiles, money } from "@/lib/format";
import type { TripRow } from "@/lib/queries/trips";
import { deleteTrip } from "./actions";

const lgHidden = "hidden lg:table-cell";

/** Trip ledger on the shared TanStack + shadcn table shell */
export function TripsTable({
  trips,
  returnTo,
  empty
}: {
  trips: TripRow[];
  /** Serialized filter + page params for post-action redirects */
  returnTo: string;
  empty: string;
}) {
  const columns: ColumnDef<TripRow, unknown>[] = [
    {
      id: "select",
      header: () => (trips.length > 0 ? <SelectAll /> : null),
      size: 36,
      enableResizing: false,
      meta: { headerClass: "check-cell", cellClass: "check-cell" },
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="row-check"
          name="selected"
          value={row.original.id}
          aria-label={`选择 ${row.original.driver_name ?? ""} ${row.original.trip_date} 的行程`}
        />
      )
    },
    {
      id: "date",
      header: "日期",
      size: 104,
      meta: { cellClass: "mono" },
      cell: ({ row }) => row.original.trip_date
    },
    {
      id: "driver",
      header: "司机 / 车主",
      size: 150,
      cell: ({ row }) => (
        <>
          <span className="strong">{row.original.driver_name ?? "—"}</span>
          <DriverTypeBadge type={row.original.driver_type} />
        </>
      )
    },
    {
      id: "truck",
      header: "车号",
      size: 88,
      meta: { cellClass: "mono" },
      cell: ({ row }) => row.original.truck_code ?? "—"
    },
    {
      id: "operation",
      header: "操作",
      size: 96,
      cell: ({ row }) => <OperationBadge operation={row.original.operation} />
    },
    {
      id: "load",
      header: "Load#",
      size: 110,
      meta: { cellClass: "mono" },
      cell: ({ row }) => row.original.load_no || "—"
    },
    {
      id: "route",
      header: "起点 → 终点",
      size: 190,
      meta: { cellClass: "mono" },
      cell: ({ row }) => (
        <>
          {row.original.from_code ?? "—"} <span className="route-arrow">→</span>{" "}
          {row.original.to_code ?? "—"}
        </>
      )
    },
    {
      id: "miles",
      header: "Miles",
      size: 80,
      meta: { headerClass: "num", cellClass: "num" },
      cell: ({ row }) => fmtMiles(row.original.miles)
    },
    {
      id: "pay",
      header: "本趟工资",
      size: 104,
      meta: { headerClass: "num", cellClass: "num" },
      cell: ({ row }) => money(row.original.pay_amount)
    },
    {
      id: "notes",
      header: "备注",
      size: 180,
      meta: { headerClass: lgHidden, cellClass: `notes-cell ${lgHidden}` },
      cell: ({ row }) => row.original.notes ?? "—"
    },
    {
      id: "actions",
      header: "操作",
      size: 64,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) => (
        <form action={deleteTrip}>
          <input type="hidden" name="id" value={row.original.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <ConfirmButton type="submit" className="linklike danger" message="删除这条行程？">
            删除
          </ConfirmButton>
        </form>
      )
    }
  ];

  const table = useRosterTable({
    data: trips,
    columns,
    storageKey: "payops.trips.cols"
  });

  return <RosterTable table={table} empty={empty} />;
}
