"use client";

import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { DriverTypeBadge, OperationBadge, PackageBadge, RoutePair } from "@/components/badges";
import { SelectAll } from "@/components/select-all";
import { ConfirmAction } from "@/components/confirm-action";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { miles as fmtMiles, money } from "@/lib/format";
import { isRedirectError } from "@/lib/action-result";
import type { TripRow } from "@/lib/queries/trips";
import { deleteTrip } from "./actions";
import { TripEditDialog, type TripEditDictionaries } from "./trip-edit-dialog";

const lgHidden = "hidden lg:table-cell";

/** Trip ledger on the shared TanStack + shadcn table shell */
export function TripsTable({
  trips,
  returnTo,
  /** When set, each row gets an edit button opening the local dialog */
  edit,
  empty
}: {
  trips: TripRow[];
  /** Serialized filter + page params for post-action redirects */
  returnTo: string;
  edit?: TripEditDictionaries;
  empty: string;
}) {
  // Local open state: clicking 编辑 opens instantly with the row's own data,
  // no navigation and no URL change
  const [editing, setEditing] = React.useState<TripRow | null>(null);

  // Stable identities: a fresh array per render churns TanStack's sizing sync
  const columns = React.useMemo<ColumnDef<TripRow, unknown>[]>(() => [
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
        <RoutePair from={row.original.from_code} to={row.original.to_code} />
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
      cell: ({ row }) => (
        <>
          {money(row.original.pay_amount)}
          {row.original.package_id && (
            <>
              {" "}
              <PackageBadge note={row.original.package_note} />
            </>
          )}
        </>
      )
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
      size: 88,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) =>
        edit ? (
          <>
            <button type="button" className="linklike" onClick={() => setEditing(row.original)}>
              编辑
            </button>
            <ConfirmAction
              danger
              title="删除这条行程？"
              description="删除后该行程将从台账与工资单中移除，不可恢复。"
              confirmLabel="删除"
              pendingLabel="删除中…"
              trigger={props => (
                <button {...props} className="linklike danger">
                  删除
                </button>
              )}
              onConfirm={async () => {
                const fd = new FormData();
                fd.set("id", row.original.id);
                fd.set("return_to", returnTo);
                try {
                  await deleteTrip(fd);
                  toast.success("行程已删除");
                } catch (error) {
                  // The action's redirect rejects with NEXT_REDIRECT on success
                  if (isRedirectError(error)) toast.success("行程已删除");
                  else toast.error("删除失败，请重试");
                }
              }}
            />
          </>
        ) : (
          <span className="text-muted-foreground">只读</span>
        )
    }
  ], [edit, returnTo, trips]); // identities stable across client re-renders (server payload)

  const table = useRosterTable({
    data: trips,
    columns,
    storageKey: "payops.trips.cols"
  });

  return (
    <>
      <RosterTable table={table} empty={empty} />
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
