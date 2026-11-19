"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/confirm-action";
import { DriverTypeBadge, StatementStatusBadge } from "@/components/badges";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { fuel as fmtFuel, miles as fmtMiles, money } from "@/lib/format";
import { isRedirectError } from "@/lib/action-result";
import type { StatementRow } from "@/lib/queries/statements";
import { verifyStatement } from "./actions";
import {
  CopyStatementButton,
  type CopyDriverOption,
  type CopyTruckOption
} from "./copy-statement-dialog";

const lgHidden = "hidden lg:table-cell";

function shortPeriod(start: string, end: string) {
  const fmt = (iso: string) => iso.slice(5).replace("-", "/");
  return `${fmt(start)} ~ ${fmt(end)}`;
}

/**
 * Draft -> verified straight from the ledger, no detour into the detail
 * sheet: one click freezes the numbers (permanent, so a confirm guards the
 * misclick). Calls the server action directly - a <form> per row inside the
 * table cell works too, but this keeps the cell markup flat.
 */
function VerifyStatementButton({ statementId }: { statementId: string }) {
  return (
    <ConfirmAction
      title="标记核对？"
      description="标记核对后金额冻结、不可退回（再改行程只会标红）。"
      confirmLabel="核对"
      pendingLabel="核对中…"
      trigger={props => (
        <button {...props} className="linklike">
          核对
        </button>
      )}
      onConfirm={async () => {
        const fd = new FormData();
        fd.set("id", statementId);
        fd.set("return_to", window.location.pathname + window.location.search);
        try {
          await verifyStatement(fd);
          toast.success("已核对，金额已冻结");
        } catch (error) {
          // The action's redirect rejects with NEXT_REDIRECT on success
          if (isRedirectError(error)) toast.success("已核对，金额已冻结");
          else toast.error("核对失败，请重试");
        }
      }}
    />
  );
}

/** Statement ledger on the shared TanStack + shadcn table shell */
export function StatementsTable({
  statements,
  drivers,
  trucks,
  empty
}: {
  statements: StatementRow[];
  /** Copy-dialog pickers, pulled by the host page (same sources as entry) */
  drivers: CopyDriverOption[];
  trucks: CopyTruckOption[];
  empty: string;
}) {
  const columns: ColumnDef<StatementRow, unknown>[] = [
    {
      id: "period",
      header: "周期",
      size: 128,
      cell: ({ row }) => (
        <Link className="cell-link mono" href={`/dashboard/payroll?period=${row.original.period_start}`}>
          {shortPeriod(row.original.period_start, row.original.period_end)}
        </Link>
      )
    },
    {
      id: "driver",
      header: "司机 / 车主",
      size: 140,
      // Same muted tones as the detail masthead: dark green = verified clean,
      // dark red = edited after verification; drafts stay neutral
      cell: ({ row }) => (
        <span
          className={
            row.original.edited_after_verify
              ? "text-red-800"
              : row.original.status === "VERIFIED"
                ? "text-emerald-800"
                : undefined
          }
        >
          {row.original.full_name}
        </span>
      )
    },
    {
      id: "type",
      header: "类型",
      size: 76,
      cell: ({ row }) => <DriverTypeBadge type={row.original.driver_type} />
    },
    {
      id: "trucks",
      header: "车号",
      size: 96,
      meta: { cellClass: `mono ${lgHidden}`, headerClass: lgHidden },
      cell: ({ row }) => row.original.trucks || "—"
    },
    {
      id: "days",
      header: "天数",
      size: 64,
      meta: { cellClass: "mono num", headerClass: "num" },
      cell: ({ row }) => row.original.trip_days
    },
    {
      id: "legs",
      header: "段数",
      size: 64,
      meta: { cellClass: "mono num", headerClass: "num" },
      cell: ({ row }) => row.original.leg_count
    },
    {
      id: "miles",
      header: "里程 (mi)",
      size: 96,
      meta: { cellClass: "mono num", headerClass: "num" },
      cell: ({ row }) => fmtMiles(row.original.total_miles)
    },
    {
      id: "fuel_gal",
      header: "加油 (gal)",
      size: 88,
      meta: { cellClass: "mono num", headerClass: "num" },
      // By-state rollup off fuel_detail (0 reads as the muted dash)
      cell: ({ row }) =>
        Number(row.original.fuel_gal) > 0 ? fmtFuel(row.original.fuel_gal) : "—"
    },
    {
      id: "subsidy",
      header: "燃油补助",
      size: 92,
      meta: { cellClass: "mono num", headerClass: "num" },
      cell: ({ row }) =>
        Number(row.original.total_fuel_subsidy) > 0 ? money(row.original.total_fuel_subsidy) : "—"
    },
    {
      id: "pay",
      header: "本周期工资",
      size: 116,
      meta: { cellClass: "mono num strong", headerClass: "num" },
      cell: ({ row }) => money(row.original.total_pay)
    },
    {
      id: "status",
      header: "状态",
      size: 96,
      cell: ({ row }) =>
        row.original.status ? (
          <StatementStatusBadge
            status={row.original.status}
            edited={row.original.edited_after_verify}
          />
        ) : (
          <span className="muted-inline">无行程</span>
        )
    },
    {
      id: "actions",
      header: "操作",
      size: 112,
      enableResizing: false,
      meta: { cellClass: "actions" },
      // Legs editing lives on the detail sheet; verify is one click away here
      cell: ({ row }) => {
        const s = row.original;
        return (
          <>
            <Link href={`/dashboard/trips/${s.driver_id}?period=${s.period_start}`}>
              详情
            </Link>
            {s.id && s.status === "DRAFT" && s.leg_count > 0 && (
              <>
                <CopyStatementButton statement={{ ...s, id: s.id }} drivers={drivers} trucks={trucks} />
                <VerifyStatementButton statementId={s.id} />
              </>
            )}
          </>
        );
      }
    }
  ];

  const table = useRosterTable({
    data: statements,
    columns,
    storageKey: "payops.statements.cols"
  });

  return (
    <RosterTable
      table={table}
      rowClassName={r =>
        r.edited_after_verify
          ? "row-flagged"
          : r.status === null && r.leg_count === 0
            ? "row-off"
            : undefined
      }
      empty={empty}
    />
  );
}
