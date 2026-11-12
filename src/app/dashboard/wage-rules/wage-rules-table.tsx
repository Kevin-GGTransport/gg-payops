"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { money } from "@/lib/format";
import type { WageRuleVersionSummary } from "@/lib/queries/wage-rules";

/** 钢印标签：已生效（audit 绿）/ 待生效（amber） */
function EffectiveBadge({ effective }: { effective: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-[3px] border px-1.5 py-px text-[11px] font-semibold leading-4 ${
        effective
          ? "border-audit/30 bg-audit/10 text-audit"
          : "border-amber-500/40 bg-amber-50 text-amber-800"
      }`}
    >
      {effective ? "已生效" : "待生效"}
    </span>
  );
}

/** Version timeline on the shared TanStack + shadcn table shell */
export function WageRulesTable({
  versions,
  today
}: {
  versions: WageRuleVersionSummary[];
  today: string;
}) {
  const columns: ColumnDef<WageRuleVersionSummary, unknown>[] = [
    {
      id: "name",
      header: "版本",
      size: 200,
      cell: ({ row }) => <span className="mono strong">{row.original.name}</span>
    },
    {
      id: "effective_from",
      header: "生效日期",
      size: 110,
      cell: ({ row }) => <span className="mono">{row.original.effective_from}</span>
    },
    {
      id: "state",
      header: "状态",
      size: 90,
      cell: ({ row }) => (
        <EffectiveBadge effective={row.original.effective_from <= today} />
      )
    },
    {
      id: "summary",
      header: "规则摘要",
      size: 360,
      meta: { cellClass: "text-muted-foreground" },
      cell: ({ row }) => {
        const v = row.original;
        return (
          <span>
            {v.tier_count} 档 {money(v.min_amount)}~{money(v.max_amount)} · 车主×
            {Number(v.owner_multiplier).toFixed(2)} · BOBTAIL×
            {Number(v.bobtail_multiplier).toFixed(2)} · 超档+{money(v.overage_increment)}/50mi · 特例 {v.special_count} 条
          </span>
        );
      }
    },
    {
      id: "actions",
      header: "操作",
      size: 70,
      enableResizing: false,
      meta: { cellClass: "actions" },
      cell: ({ row }) => (
        <Link href={`/dashboard/wage-rules?v=${row.original.id}`}>详情</Link>
      )
    }
  ];

  const table = useRosterTable({
    data: versions,
    columns,
    storageKey: "payops.wage-rules.cols"
  });

  return <RosterTable table={table} empty="还没有任何规则版本。" />;
}
