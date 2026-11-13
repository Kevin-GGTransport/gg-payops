"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { DriverTypeBadge, StatementStatusBadge } from "@/components/badges";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { miles as fmtMiles, money } from "@/lib/format";
import { STATEMENT_STATUS_FLOW, STATEMENT_STATUS_LABELS, type StatementStatus } from "@/lib/labels";
import type { StatementRow } from "@/lib/queries/statements";
import { advanceStatement, revertStatement, deleteStatement } from "./actions";

const lgHidden = "hidden lg:table-cell";

function nextStatus(status: StatementStatus): StatementStatus | null {
  const i = STATEMENT_STATUS_FLOW.indexOf(status);
  return i < STATEMENT_STATUS_FLOW.length - 1 ? STATEMENT_STATUS_FLOW[i + 1] : null;
}

function prevStatus(status: StatementStatus): StatementStatus | null {
  const i = STATEMENT_STATUS_FLOW.indexOf(status);
  return i > 0 ? STATEMENT_STATUS_FLOW[i - 1] : null;
}

function shortPeriod(start: string, end: string) {
  const fmt = (iso: string) => iso.slice(5).replace("-", "/");
  return `${fmt(start)} ~ ${fmt(end)}`;
}

/** Statement ledger on the shared TanStack + shadcn table shell */
export function StatementsTable({
  statements,
  returnTo,
  returnQuery,
  empty
}: {
  statements: StatementRow[];
  /** Full path actions redirect() back to */
  returnTo: string;
  /** Same filters as a query string, for building the edit-dialog href */
  returnQuery: string;
  empty: string;
}) {
  const columns: ColumnDef<StatementRow, unknown>[] = [
    {
      id: "period",
      header: "周期",
      size: 128,
      cell: ({ row }) => <span className="mono strong">{shortPeriod(row.original.period_start, row.original.period_end)}</span>
    },
    {
      id: "driver",
      header: "司机 / 车主",
      size: 140,
      cell: ({ row }) => (
        <Link
          className="cell-link"
          href={`/dashboard/trips/${row.original.driver_id}?period=${row.original.period_start}`}
        >
          {row.original.full_name}
        </Link>
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
      id: "pay",
      header: "本周期工资",
      size: 116,
      meta: { cellClass: "mono num strong", headerClass: "num" },
      cell: ({ row }) => money(row.original.total_pay)
    },
    {
      id: "status",
      header: "状态",
      size: 80,
      cell: ({ row }) =>
        row.original.status ? (
          <StatementStatusBadge status={row.original.status} />
        ) : (
          <span className="muted-inline">未生成</span>
        )
    },
    {
      id: "actions",
      header: "操作",
      size: 200,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) => {
        const s = row.original;
        // Not generated yet: numbers are live, actions live on the page bar
        if (!s.status || !s.id) return "—";
        const next = nextStatus(s.status);
        const prev = prevStatus(s.status);
        const editable = s.status === "DRAFT" || s.status === "VERIFIED";
        return (
          <>
            {editable && (
              <Link href={`/dashboard/payroll?edit=${s.id}${returnQuery ? `&${returnQuery}` : ""}`}>
                编辑
              </Link>
            )}
            {next && (
              <form action={advanceStatement} className="inline">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <button type="submit" className="linklike">
                  {next === "DONE" ? "完成" : `推进至${STATEMENT_STATUS_LABELS[next]}`}
                </button>
              </form>
            )}
            {prev && (
              <form action={revertStatement} className="inline">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <button type="submit" className="linklike">
                  回退
                </button>
              </form>
            )}
            {s.status === "DRAFT" && (
              <form action={deleteStatement} className="inline">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <button type="submit" className="linklike danger">
                  删除
                </button>
              </form>
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

  return <RosterTable table={table} rowClassName={r => (r.status === null && r.leg_count === 0 ? "row-off" : undefined)} empty={empty} />;
}
