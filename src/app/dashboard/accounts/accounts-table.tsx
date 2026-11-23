"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";

import { RoleBadge, StatusPill } from "@/components/badges";
import { LG_HIDDEN, RosterTable, useRosterTable } from "@/components/roster-table";
import { SubmitButton } from "@/components/submit-button";
import type { AccountRow } from "@/lib/queries/accounts";
import { setAccountStatus } from "./actions";


/** Account roster on the shared TanStack + shadcn table shell */
export function AccountsTable({
  accounts,
  canWrite,
  filterQuery,
  currentUserId,
  empty
}: {
  accounts: AccountRow[];
  /** Convenience only - the actions re-check permissions server-side */
  canWrite: boolean;
  /** Current filter query string, kept on the edit/reset links */
  filterQuery: string;
  /** Own row: the deactivate control hides (server refuses anyway) */
  currentUserId: string;
  empty: string;
}) {
  const columns = React.useMemo<ColumnDef<AccountRow, unknown>[]>(
    () => [
      {
        id: "email",
        header: "账号",
        size: 170,
        cell: ({ row }) => (
          <span className="mono strong">{row.original.email}</span>
        )
      },
      {
        id: "name",
        header: "姓名",
        size: 130,
        cell: ({ row }) => <span className="strong">{row.original.display_name}</span>
      },
      {
        id: "roles",
        header: "角色",
        size: 240,
        // Stamps stay capped at two +N so wide grants never blow the row
        cell: ({ row }) => {
          const roles = row.original.roles;
          if (roles.length === 0) return <span className="text-muted-foreground">未分配</span>;
          return (
            <span className="inline-flex flex-wrap items-center gap-1">
              {roles.slice(0, 2).map(r => (
                <RoleBadge key={r.code} name={r.name} />
              ))}
              {roles.length > 2 && (
                <span className="text-[11px] font-semibold text-muted-foreground">
                  +{roles.length - 2}
                </span>
              )}
            </span>
          );
        }
      },
      {
        id: "driver",
        header: "关联司机",
        size: 120,
        cell: ({ row }) => row.original.linked_driver_name ?? "—"
      },
      {
        id: "status",
        header: "状态",
        size: 84,
        cell: ({ row }) => <StatusPill status={row.original.is_active ? "ACTIVE" : "INACTIVE"} />
      },
      {
        id: "last_login",
        header: "最后登录",
        size: 130,
        meta: { cellClass: `mono ${LG_HIDDEN}`, headerClass: LG_HIDDEN },
        cell: ({ row }) => row.original.last_login_at ?? "—"
      },
      {
        id: "actions",
        header: "操作",
        size: 190,
        enableResizing: false,
        meta: { cellClass: "actions" },
        cell: ({ row }) => {
          const account = row.original;
          if (!canWrite) {
            return <span className="text-muted-foreground">只读</span>;
          }
          const suffix = filterQuery ? `&${filterQuery}` : "";
          return (
            <>
              <Link href={`/dashboard/accounts?edit=${account.id}${suffix}`}>编辑</Link>
              <Link href={`/dashboard/accounts?reset=${account.id}${suffix}`}>重置密码</Link>
              {account.id !== currentUserId && (
                <form action={setAccountStatus}>
                  <input type="hidden" name="id" value={account.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={account.is_active ? "INACTIVE" : "ACTIVE"}
                  />
                  <SubmitButton className="linklike" pendingLabel="处理中…">
                    {account.is_active ? "停用" : "启用"}
                  </SubmitButton>
                </form>
              )}
            </>
          );
        }
      }
    ],
    [canWrite, filterQuery, currentUserId]
  );

  const table = useRosterTable({
    data: accounts,
    columns,
    storageKey: "payops.accounts.cols"
  });

  return (
    <RosterTable
      table={table}
      rowClassName={a => (a.is_active ? undefined : "row-off")}
      empty={empty}
    />
  );
}
