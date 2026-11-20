"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { ConfirmButton } from "@/components/confirm-button";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import type { RoleRow } from "@/lib/queries/roles";
import { deleteRole } from "./actions";

/** Role roster on the shared TanStack + shadcn table shell */
export function RolesTable({
  roles,
  canWrite
}: {
  roles: RoleRow[];
  /** Convenience only - the actions re-check permissions server-side */
  canWrite: boolean;
}) {
  const columns = React.useMemo<ColumnDef<RoleRow, unknown>[]>(
    () => [
      {
        id: "code",
        header: "代码",
        size: 170,
        cell: ({ row }) => <span className="mono strong">{row.original.code}</span>
      },
      {
        id: "name",
        header: "名称",
        size: 160,
        cell: ({ row }) => row.original.name
      },
      {
        id: "kind",
        header: "类型",
        size: 110,
        cell: ({ row }) =>
          row.original.is_system ? (
            <span className="inline-flex items-center rounded-[3px] border border-route/30 bg-route/10 px-1.5 py-px text-[11px] font-semibold leading-4 text-route">
              系统预置
            </span>
          ) : (
            <span className="inline-flex items-center rounded-[3px] border border-line bg-muted/60 px-1.5 py-px text-[11px] font-semibold leading-4 text-foreground">
              自定义
            </span>
          )
      },
      {
        id: "user_count",
        header: "账号数",
        size: 90,
        meta: { headerClass: "num", cellClass: "mono num" },
        cell: ({ row }) => row.original.user_count
      },
      {
        id: "permission_count",
        header: "权限数",
        size: 90,
        meta: { headerClass: "num", cellClass: "mono num" },
        cell: ({ row }) => row.original.permissions.length
      },
      {
        id: "actions",
        header: "操作",
        size: 150,
        enableResizing: false,
        meta: { cellClass: "actions" },
        cell: ({ row }) => {
          const role = row.original;
          return (
            <>
              <Link href={`/dashboard/roles?edit=${role.id}`}>编辑</Link>
              {canWrite && !role.is_system && role.user_count === 0 && (
                <form action={deleteRole}>
                  <input type="hidden" name="id" value={role.id} />
                  <ConfirmButton
                    className="linklike"
                    title={`删除角色 ${role.name}？`}
                    message="此操作不可撤销。"
                    danger
                  >
                    删除
                  </ConfirmButton>
                </form>
              )}
            </>
          );
        }
      }
    ],
    [canWrite]
  );

  const table = useRosterTable({
    data: roles,
    columns,
    storageKey: "payops.roles.cols"
  });

  return <RosterTable table={table} empty="还没有角色。" />;
}
