"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { LocationTypeBadge, StatusPill } from "@/components/badges";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { SubmitButton } from "@/components/submit-button";
import { fullAddress } from "@/lib/format";
import type { LocationRow } from "@/lib/queries/locations";
import { setLocationStatus } from "./actions";

/** Location roster on the shared TanStack + shadcn table shell */
export function LocationsTable({
  locations,
  empty
}: {
  locations: LocationRow[];
  empty: string;
}) {
  // Stable identity across client re-renders: a fresh array per render churns
  // TanStack's sizing sync (the freeze family)
  const columns = React.useMemo<ColumnDef<LocationRow, unknown>[]>(() => [
    {
      id: "code",
      header: "代码",
      size: 96,
      cell: ({ row }) => <span className="mono strong">{row.original.code}</span>
    },
    {
      id: "name",
      header: "名称",
      size: 180,
      cell: ({ row }) => row.original.name
    },
    {
      id: "address",
      header: "详细地址",
      size: 320,
      meta: { cellClass: "text-muted-foreground" },
      cell: ({ row }) => fullAddress(row.original) || "—"
    },
    {
      id: "type",
      header: "类型",
      size: 110,
      cell: ({ row }) => (
        <>
          <LocationTypeBadge type={row.original.location_type} />
          {row.original.class_tag && (
            <>
              {" "}
              <span className="inline-flex items-center rounded-[3px] border border-route/30 bg-route/10 px-1.5 py-px text-[11px] font-semibold leading-4 text-route">
                #{row.original.class_tag}
              </span>
            </>
          )}
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
      size: 140,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) => {
        const location = row.original;
        return (
          <>
            <Link href={`/dashboard/locations?edit=${location.id}`}>编辑</Link>
            <form action={setLocationStatus}>
              <input type="hidden" name="id" value={location.id} />
              <input
                type="hidden"
                name="status"
                value={location.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
              />
              <SubmitButton className="linklike" pendingLabel="处理中…">
                {location.status === "ACTIVE" ? "停用" : "启用"}
              </SubmitButton>
            </form>
          </>
        );
      }
    }
  ], []);

  const table = useRosterTable({
    data: locations,
    columns,
    storageKey: "payops.locations.cols"
  });

  return (
    <RosterTable
      table={table}
      rowClassName={location => (location.status !== "ACTIVE" ? "row-off" : undefined)}
      empty={empty}
    />
  );
}
