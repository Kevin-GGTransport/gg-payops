"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { StatusPill } from "@/components/badges";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { odometerMi } from "@/lib/format";
import type { TruckRow } from "@/lib/queries/trucks";
import { setTruckStatus } from "./actions";

/** Truck roster on the shared TanStack + shadcn table shell */
export function TrucksTable({
  trucks,
  returnTo,
  empty
}: {
  trucks: TruckRow[];
  returnTo: string;
  empty: string;
}) {
  const columns: ColumnDef<TruckRow, unknown>[] = [
    {
      id: "code",
      header: "车号",
      size: 96,
      cell: ({ row }) => <span className="mono strong">{row.original.truck_code}</span>
    },
    {
      id: "plate",
      header: "车牌号",
      size: 110,
      meta: { cellClass: "mono" },
      cell: ({ row }) => row.original.plate_no ?? "—"
    },
    {
      id: "type",
      header: "车型",
      size: 120,
      cell: ({ row }) => row.original.truck_type ?? "—"
    },
    {
      id: "ownership",
      header: "归属",
      size: 140,
      cell: ({ row }) =>
        row.original.ownership_id === null ? (
          <span className="text-muted-foreground">未登记</span>
        ) : row.original.owner_id ? (
          <span className="strong">{row.original.owner_name}</span>
        ) : (
          <span className="rounded-[3px] border border-line bg-card px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
            公司自有
          </span>
        )
    },
    {
      id: "odometer",
      header: "表显里程",
      size: 150,
      meta: { cellClass: "mono" },
      cell: ({ row }) =>
        row.original.odometer === null ? (
          "—"
        ) : (
          <>
            {odometerMi(row.original.odometer)}
            <span className="muted-inline">{row.original.odometer_date}</span>
          </>
        )
    },
    {
      id: "status",
      header: "状态",
      size: 84,
      cell: ({ row }) => <StatusPill status={row.original.status} />
    },
    {
      id: "actions",
      header: "操作",
      size: 168,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) => {
        const truck = row.original;
        return (
          <>
            <Link href={`/dashboard/trucks?edit=${truck.id}${returnTo ? `&${returnTo}` : ""}`}>
              编辑
            </Link>
            <Link href={`/dashboard/trucks?odo=${truck.id}${returnTo ? `&${returnTo}` : ""}`}>
              里程
            </Link>
            <form action={setTruckStatus}>
              <input type="hidden" name="id" value={truck.id} />
              <input
                type="hidden"
                name="status"
                value={truck.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
              />
              <input type="hidden" name="return_to" value={returnTo} />
              <button type="submit" className="linklike">
                {truck.status === "ACTIVE" ? "停用" : "启用"}
              </button>
            </form>
          </>
        );
      }
    }
  ];

  const table = useRosterTable({
    data: trucks,
    columns,
    storageKey: "payops.trucks.cols"
  });

  return (
    <RosterTable
      table={table}
      rowClassName={truck => (truck.status !== "ACTIVE" ? "row-off" : undefined)}
      empty={empty}
    />
  );
}
