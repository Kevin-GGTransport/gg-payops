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
import type { StatementListRow } from "@/lib/queries/statements";
import { confirmDriverStatement, verifyStatement } from "./actions";
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

/**
 * VERIFIED -> driver-confirmed (DONE) straight from the ledger, mirroring the
 * verify button: one click, a confirm dialog guards the misclick, and the
 * numbers were already frozen at verification so nothing recomputes.
 */
function ConfirmDriverButton({ statementId }: { statementId: string }) {
  return (
    <ConfirmAction
      title="标记司机确认？"
      description="标记后该工资单视为司机已确认（金额不变，仍冻结）。"
      confirmLabel="司机确认"
      pendingLabel="确认中…"
      trigger={props => (
        <button {...props} className="linklike">
          司机确认
        </button>
      )}
      onConfirm={async () => {
        const fd = new FormData();
        fd.set("id", statementId);
        fd.set("return_to", window.location.pathname + window.location.search);
        try {
          await confirmDriverStatement(fd);
          toast.success("司机已确认");
        } catch (error) {
          // The action's redirect rejects with NEXT_REDIRECT on success
          if (isRedirectError(error)) toast.success("司机已确认");
          else toast.error("标记失败，请重试");
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
  canVerify,
  canConfirm,
  canCopy,
  empty
}: {
  statements: StatementListRow[];
  /** Copy-dialog pickers, pulled by the host page (same sources as entry) */
  drivers: CopyDriverOption[];
  trucks: CopyTruckOption[];
  /** Convenience only - the actions re-check permissions server-side */
  canVerify: boolean;
  canConfirm: boolean;
  canCopy: boolean;
  empty: string;
}) {
  // Stable identity across client re-renders (toasts, dialogs): a fresh array
  // per render churns TanStack's sizing sync (same family as the entry-sheet
  // freeze); rebuilt only when the server sends new copy-dialog pickers
  const columns = React.useMemo<ColumnDef<StatementListRow, unknown>[]>(() => [
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
      // Same muted tones as the detail masthead: dark green = verified, dark
      // red = driver confirmed; drafts stay neutral. Edits after checking are
      // a detail-sheet concern - the list never flags them
      cell: ({ row }) => (
        <span
          className={
            row.original.status === "DONE"
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
      // Main value = archived pay + fees (fees stay editable after confirm).
      // Two independent sub-lines may stack: the fee total and, on archived
      // (DONE) sheets whose live sum drifted, the live number - VERIFIED
      // sheets track live so they never drift
      cell: ({ row }) => {
        const s = row.original;
        const fees = Number(s.total_custom_fees);
        const drifted =
          s.status === "DONE" && Number(s.live_pay) !== Number(s.total_pay);
        return drifted || fees !== 0 ? (
          <>
            <span>{money(Number(s.total_pay) + fees)}</span>
            {fees !== 0 && (
              <span className="block text-[11px] leading-tight font-normal text-muted-foreground">
                费用 +{money(fees)}
              </span>
            )}
            {drifted && (
              <span className="block text-[11px] leading-tight font-normal text-red-600">
                实时 {money(s.live_pay)}
              </span>
            )}
          </>
        ) : (
          money(s.total_pay)
        );
      }
    },
    {
      id: "status",
      header: "状态",
      size: 96,
      cell: ({ row }) =>
        row.original.status ? (
          <StatementStatusBadge status={row.original.status} />
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
      // Legs editing lives on the detail sheet; verify and the driver
      // confirmation are one click away here (each on its own status)
      cell: ({ row }) => {
        const s = row.original;
        return (
          <>
            <Link href={`/dashboard/trips/${s.driver_id}?period=${s.period_start}`}>
              详情
            </Link>
            {canVerify && s.id && s.status === "DRAFT" && s.leg_count > 0 && (
              <>
                {canCopy && (
                  <CopyStatementButton statement={{ ...s, id: s.id }} drivers={drivers} trucks={trucks} />
                )}
                <VerifyStatementButton statementId={s.id} />
              </>
            )}
            {canConfirm && s.id && s.status === "VERIFIED" && (
              <ConfirmDriverButton statementId={s.id} />
            )}
          </>
        );
      }
    }
  ], [drivers, trucks, canVerify, canConfirm, canCopy]);

  const table = useRosterTable({
    data: statements,
    columns,
    storageKey: "payops.statements.cols"
  });

  return (
    <RosterTable
      table={table}
      rowClassName={r => (r.status === null && r.leg_count === 0 ? "row-off" : undefined)}
      empty={empty}
    />
  );
}
