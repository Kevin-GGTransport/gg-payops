"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { StatusPill } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import type { OperationTypeRow } from "@/lib/queries/operations";
import { deleteOperation, setOperationStatus } from "./actions";

/** Operation dictionary roster on the shared TanStack + shadcn table shell */
export function OperationsTable({
  operations,
  empty
}: {
  operations: OperationTypeRow[];
  empty: string;
}) {
  const columns: ColumnDef<OperationTypeRow, unknown>[] = [
    {
      id: "code",
      header: "代码",
      size: 110,
      cell: ({ row }) => <span className="mono strong">{row.original.code}</span>
    },
    {
      id: "label",
      header: "名称",
      size: 150,
      cell: ({ row }) => row.original.label
    },
    {
      id: "description",
      header: "说明",
      size: 220,
      meta: { cellClass: "text-muted-foreground" },
      cell: ({ row }) => row.original.description || "—"
    },
    {
      id: "requires_load",
      header: "需填 Load#",
      size: 100,
      meta: { headerClass: "num", cellClass: "num" },
      cell: ({ row }) => (row.original.requires_load ? "是" : "否")
    },
    {
      id: "sort_order",
      header: "排序",
      size: 76,
      meta: { headerClass: "num", cellClass: "num" },
      cell: ({ row }) => row.original.sort_order
    },
    {
      id: "trip_count",
      header: "行程数",
      size: 90,
      meta: { headerClass: "num", cellClass: "num" },
      cell: ({ row }) => row.original.trip_count
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
      size: 170,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) => {
        const op = row.original;
        return (
          <>
            <Link href={`/dashboard/operations?edit=${op.id}`}>编辑</Link>
            {!op.is_system && (
              <form action={setOperationStatus}>
                <input type="hidden" name="id" value={op.id} />
                <input
                  type="hidden"
                  name="status"
                  value={op.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
                />
                <button type="submit" className="linklike">
                  {op.status === "ACTIVE" ? "停用" : "启用"}
                </button>
              </form>
            )}
            {!op.is_system && (
              <form action={deleteOperation}>
                <input type="hidden" name="id" value={op.id} />
                <ConfirmButton type="submit" className="linklike" message={`确定删除操作类型 ${op.code}（${op.label}）吗？`}>
                  删除
                </ConfirmButton>
              </form>
            )}
            {op.is_system && <span className="text-muted-foreground">系统内置</span>}
          </>
        );
      }
    }
  ];

  const table = useRosterTable({
    data: operations,
    columns,
    storageKey: "payops.operations.cols"
  });

  return (
    <RosterTable
      table={table}
      rowClassName={op => (op.status !== "ACTIVE" ? "row-off" : undefined)}
      empty={empty}
    />
  );
}
