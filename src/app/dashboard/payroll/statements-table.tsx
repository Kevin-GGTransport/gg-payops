"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { DriverTypeBadge, StatementStatusBadge } from "@/components/badges";
import { LG_HIDDEN, RosterTable, useRosterTable } from "@/components/roster-table";
import { StatusActionButton } from "@/components/status-action-button";
import { fuel as fmtFuel, miles as fmtMiles, money, shortPeriod } from "@/lib/format";
import type { StatementListRow } from "@/lib/queries/statements";
import { confirmDriverStatement, reopenStatement, verifyStatement } from "./actions";
import {
  CopyStatementButton,
  type CopyDriverOption,
  type CopyTruckOption
} from "./copy-statement-dialog";

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
      // Lifecycle color fills the name cell: solid green once checked, solid
      // red once driver-confirmed (cell-fill bleeds over the td padding);
      // drafts stay plain. Edits after checking are a detail-sheet concern -
      // the list never flags them
      cell: ({ row }) => {
        const s = row.original;
        if (s.status !== "DONE" && s.status !== "VERIFIED") return s.full_name;
        return (
          <span className={`cell-fill ${s.status === "DONE" ? "cell-fill-red" : "cell-fill-green"}`}>
            {s.full_name}
          </span>
        );
      }
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
      meta: { cellClass: `mono ${LG_HIDDEN}`, headerClass: LG_HIDDEN },
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
                {/* One click marks the sheet checked (live tracking stays on;
                    the confirm guards the misclick) - no detour into the
                    detail sheet */}
                <StatusActionButton
                  statementId={s.id}
                  action={verifyStatement}
                  labels={{
                    title: "标记核对？",
                    description: "标记核对后数字仍实时跟随行程（不可退回）；司机确认后才会冻结留档。",
                    confirmLabel: "核对",
                    pendingLabel: "核对中…",
                    trigger: "核对",
                    successToast: "已核对",
                    failureToast: "核对失败，请重试"
                  }}
                />
              </>
            )}
            {canConfirm && s.id && s.status === "VERIFIED" && (
              /* Confirmation freezes numbers + snapshot in one shot */
              <StatusActionButton
                statementId={s.id}
                action={confirmDriverStatement}
                labels={{
                  title: "标记司机确认？",
                  description: "标记后金额冻结留档、行程只读；如需修改须「退回编辑」后重新确认。",
                  confirmLabel: "司机确认",
                  pendingLabel: "确认中…",
                  trigger: "司机确认",
                  successToast: "司机已确认",
                  failureToast: "标记失败，请重试"
                }}
              />
            )}
            {canConfirm && s.id && s.status === "DONE" && (
              /* The only door back from the frozen archive: reopen to edit,
                 fix, then confirm again to re-lock a fresh snapshot */
              <StatusActionButton
                statementId={s.id}
                action={reopenStatement}
                labels={{
                  title: "退回编辑？",
                  description:
                    "该工资单已司机确认。退回后行程恢复可编辑、数字实时跟随，修改后需重新点「司机确认」更新并锁定快照（原留档快照将被覆盖，不留历史）。",
                  confirmLabel: "退回编辑",
                  pendingLabel: "退回中…",
                  trigger: "退回编辑",
                  successToast: "已退回编辑",
                  failureToast: "退回失败，请重试"
                }}
              />
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
