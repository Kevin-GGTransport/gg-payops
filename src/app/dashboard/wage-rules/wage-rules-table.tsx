"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { WageRuleStateBadge } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { money } from "@/lib/format";
import { activateVersion } from "./actions";
import type { WageRuleVersionSummary } from "@/lib/queries/wage-rules";

/** Version list on the shared TanStack + shadcn table shell */
export function WageRulesTable({
  versions,
  selectedId,
  canActivate
}: {
  versions: WageRuleVersionSummary[];
  /** Currently opened version: its row gets the route-blue pick line */
  selectedId?: string;
  /** Convenience only - the action re-checks permissions server-side */
  canActivate: boolean;
}) {
  // Stable identity across client re-renders: a fresh array per render churns
  // TanStack's sizing sync (the freeze family)
  const columns = React.useMemo<ColumnDef<WageRuleVersionSummary, unknown>[]>(() => [
    {
      id: "name",
      header: "版本",
      size: 200,
      cell: ({ row }) => <span className="mono strong">{row.original.name}</span>
    },
    {
      id: "created_on",
      header: "创建日期",
      size: 110,
      cell: ({ row }) => <span className="mono">{row.original.created_on}</span>
    },
    {
      id: "state",
      header: "状态",
      size: 90,
      cell: ({ row }) => (
        <WageRuleStateBadge
          effective={row.original.status === "ACTIVE"}
          label={row.original.status === "ACTIVE" ? "生效中" : "未生效"}
        />
      )
    },
    {
      id: "summary",
      header: "规则摘要",
      size: 280,
      meta: { cellClass: "text-muted-foreground" },
      cell: ({ row }) => {
        const v = row.original;
        return (
          <span>
            价格规则 {v.price_rule_count} 条 · {v.tier_count} 档 {money(v.min_amount)}~
            {money(v.max_amount)} 兜底 · 车主×{Number(v.owner_multiplier).toFixed(2)}
          </span>
        );
      }
    },
    {
      id: "actions",
      header: "操作",
      size: 130,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) =>
        row.original.status === "ACTIVE" ? (
          <Link href={`/dashboard/wage-rules?v=${row.original.id}`}>详情</Link>
        ) : (
          <span className="inline-flex items-center gap-3">
            <Link href={`/dashboard/wage-rules?v=${row.original.id}`}>详情</Link>
            {canActivate && (
              <form action={activateVersion} className="contents">
                <input type="hidden" name="id" value={row.original.id} />
                <ConfirmButton
                  className="button button-quiet h-7! px-2! text-xs"
                  title="将该版本设为生效？"
                  message="当前生效版本会立即停用，新录入的行程按新版本计价。"
                >
                  设为生效
                </ConfirmButton>
              </form>
            )}
          </span>
        )
    }
  ], [canActivate]);

  const table = useRosterTable({
    data: versions,
    columns,
    storageKey: "payops.wage-rules.cols"
  });

  return (
    <RosterTable
      table={table}
      empty="还没有任何规则版本。"
      rowClassName={row => (row.id === selectedId ? "row-pick" : undefined)}
    />
  );
}
