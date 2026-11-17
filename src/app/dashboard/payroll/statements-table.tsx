"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { DriverTypeBadge, StatementStatusBadge } from "@/components/badges";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { miles as fmtMiles, money } from "@/lib/format";
import type { StatementRow } from "@/lib/queries/statements";
import { verifyStatement } from "./actions";

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
  const [pending, setPending] = React.useState(false);
  return (
    <button
      type="button"
      className="linklike"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("标记核对后金额冻结、不可退回（再改行程只会标红），确定核对？")) return;
        setPending(true);
        const fd = new FormData();
        fd.set("id", statementId);
        fd.set("return_to", window.location.pathname + window.location.search);
        // verifyStatement redirects back to this list; the redirect itself is
        // the error surface, so a rejected promise just stops the spinner
        verifyStatement(fd).finally(() => setPending(false));
      }}
    >
      {pending ? "核对中…" : "核对"}
    </button>
  );
}

/** Statement ledger on the shared TanStack + shadcn table shell */
export function StatementsTable({
  statements,
  empty
}: {
  statements: StatementRow[];
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
      cell: ({ row }) => row.original.full_name
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
              <VerifyStatementButton statementId={s.id} />
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
