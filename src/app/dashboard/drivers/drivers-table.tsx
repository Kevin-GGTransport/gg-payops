"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { DriverTypeBadge, StatusPill } from "@/components/badges";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { daysUntil } from "@/lib/format";
import type { DriverRow } from "@/lib/queries/drivers";
import { setDriverStatus } from "./actions";

const lgHidden = "hidden lg:table-cell";

/** Driver roster on the shared TanStack + shadcn table shell */
export function DriversTable({
  drivers,
  returnTo,
  empty
}: {
  drivers: DriverRow[];
  returnTo: string;
  empty: string;
}) {
  const columns: ColumnDef<DriverRow, unknown>[] = [
    {
      id: "code",
      header: "车号",
      size: 96,
      cell: ({ row }) => <span className="mono strong">{row.original.driver_code}</span>
    },
    {
      id: "name",
      header: "姓名",
      size: 120,
      cell: ({ row }) => <span className="strong">{row.original.full_name}</span>
    },
    {
      id: "type",
      header: "类型",
      size: 88,
      cell: ({ row }) => <DriverTypeBadge type={row.original.driver_type} />
    },
    {
      id: "phone",
      header: "电话",
      size: 130,
      meta: { headerClass: lgHidden, cellClass: `mono ${lgHidden}` },
      cell: ({ row }) => row.original.phone ?? "—"
    },
    {
      id: "license",
      header: "驾照号",
      size: 168,
      meta: { headerClass: lgHidden, cellClass: `mono ${lgHidden}` },
      cell: ({ row }) => (
        <>
          {row.original.license_no ?? "—"}
          {row.original.license_class && (
            <span className="lic-class">{row.original.license_class}</span>
          )}
        </>
      )
    },
    {
      id: "expiry",
      header: "驾照到期",
      size: 136,
      meta: { headerClass: lgHidden, cellClass: lgHidden },
      cell: ({ row }) => {
        const expiry = row.original.license_expires_on;
        const days = expiry ? daysUntil(expiry) : null;
        const cls = days === null ? "" : days < 0 ? "expired" : days <= 90 ? "expiring" : "";
        return (
          <span className={`mono ${cls}`}>
            {expiry ?? "—"}
            {cls === "expired" && <span className="lic-flag">已过期</span>}
            {cls === "expiring" && <span className="lic-flag">90 天内</span>}
          </span>
        );
      }
    },
    {
      id: "hire",
      header: "入职日期",
      size: 120,
      meta: { headerClass: lgHidden, cellClass: `mono ${lgHidden}` },
      cell: ({ row }) => row.original.hire_date ?? "—"
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
      size: 148,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) => {
        const driver = row.original;
        return (
          <>
            <Link href={`/dashboard/drivers?edit=${driver.id}`}>编辑</Link>
            <form action={setDriverStatus}>
              <input type="hidden" name="id" value={driver.id} />
              <input
                type="hidden"
                name="status"
                value={driver.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
              />
              <input type="hidden" name="return_to" value={returnTo} />
              <button type="submit" className="linklike">
                {driver.status === "ACTIVE" ? "停用" : "启用"}
              </button>
            </form>
          </>
        );
      }
    }
  ];

  const table = useRosterTable({
    data: drivers,
    columns,
    storageKey: "payops.drivers.cols"
  });

  return (
    <RosterTable
      table={table}
      rowClassName={driver => (driver.status !== "ACTIVE" ? "row-off" : undefined)}
      empty={empty}
    />
  );
}
