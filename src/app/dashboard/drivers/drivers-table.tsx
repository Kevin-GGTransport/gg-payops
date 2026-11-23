"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { DriverTypeBadge, StatusPill } from "@/components/badges";
import { inactiveRowClass, LG_HIDDEN, RosterTable, useRosterTable } from "@/components/roster-table";
import { SubmitButton } from "@/components/submit-button";
import { daysUntil } from "@/lib/format";
import { PRICING_MODE_LABELS } from "@/lib/labels";
import type { DriverRow } from "@/lib/queries/drivers";
import { setDriverStatus } from "./actions";


/** Driver roster on the shared TanStack + shadcn table shell */
export function DriversTable({
  drivers,
  returnTo,
  canWrite,
  empty
}: {
  drivers: DriverRow[];
  returnTo: string;
  /** Convenience only - the actions re-check permissions server-side */
  canWrite: boolean;
  empty: string;
}) {
  // Stable identity across client re-renders: a fresh array per render churns
  // TanStack's sizing sync (the freeze family); rebuilt only when the return
  // path changes
  const columns = React.useMemo<ColumnDef<DriverRow, unknown>[]>(() => [
    {
      id: "name",
      header: "姓名",
      size: 152,
      cell: ({ row }) => <span className="strong">{row.original.full_name}</span>
    },
    {
      id: "type",
      header: "类型",
      size: 88,
      cell: ({ row }) => <DriverTypeBadge type={row.original.driver_type} />
    },
    {
      id: "pricing",
      header: "计价",
      size: 92,
      // Per-leg stays muted noise; a fixed-price mode is worth the emphasis
      cell: ({ row }) => (
        <span
          className={
            row.original.pricing_mode === "LEG"
              ? "text-muted-foreground"
              : "font-medium"
          }
        >
          {PRICING_MODE_LABELS[row.original.pricing_mode] ?? PRICING_MODE_LABELS.LEG}
        </span>
      )
    },
    {
      id: "phone",
      header: "电话",
      size: 130,
      meta: { headerClass: LG_HIDDEN, cellClass: `mono ${LG_HIDDEN}` },
      cell: ({ row }) => row.original.phone ?? "—"
    },
    {
      id: "license",
      header: "驾照号",
      size: 152,
      meta: { headerClass: LG_HIDDEN, cellClass: `mono ${LG_HIDDEN}` },
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
      size: 128,
      meta: { headerClass: LG_HIDDEN, cellClass: LG_HIDDEN },
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
      size: 112,
      meta: { headerClass: LG_HIDDEN, cellClass: `mono ${LG_HIDDEN}` },
      cell: ({ row }) => row.original.hire_date ?? "—"
    },
    {
      id: "status",
      header: "状态",
      size: 76,
      cell: ({ row }) => <StatusPill status={row.original.status} />
    },
    {
      id: "actions",
      header: "操作",
      size: 132,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) => {
        const driver = row.original;
        return canWrite ? (
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
              <SubmitButton className="linklike" pendingLabel="处理中…">
                {driver.status === "ACTIVE" ? "停用" : "启用"}
              </SubmitButton>
            </form>
          </>
        ) : (
          <span className="text-muted-foreground">只读</span>
        );
      }
    }
  ], [returnTo, canWrite]);

  const table = useRosterTable({
    data: drivers,
    columns,
    storageKey: "payops.drivers.cols"
  });

  return (
    <RosterTable
      table={table}
      rowClassName={inactiveRowClass}
      empty={empty}
    />
  );
}
