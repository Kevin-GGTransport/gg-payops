"use client";

import Link from "next/link";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/confirm-action";
import { StatementStatusBadge } from "@/components/badges";
import { miles as fmtMiles, money } from "@/lib/format";
import { isRedirectError } from "@/lib/action-result";
import type { StatementListRow } from "@/lib/queries/statements";
import { confirmDriverStatement } from "./actions";

function shortPeriod(start: string, end: string) {
  const fmt = (iso: string) => iso.slice(5).replace("-", "/");
  return `${fmt(start)} ~ ${fmt(end)}`;
}

/**
 * VERIFIED -> DONE straight from the card, mirroring the ledger's confirm
 * button: same action, same toasts, a confirm dialog guarding the tap.
 */
function ConfirmCardButton({ statementId }: { statementId: string }) {
  return (
    <ConfirmAction
      title="标记司机确认？"
      description="标记后该工资单视为司机已确认（金额不变，仍冻结）。"
      confirmLabel="司机确认"
      pendingLabel="确认中…"
      trigger={props => (
        <button {...props} className="button button-dark h-11 flex-1 text-[15px]">
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

/**
 * The driver's own payroll on phones: one card per period (the ledger row,
 * transposed). Header = period + status + leg summary, then a navy pay band
 * (the gauge strip's mobile echo, amber figure on navy), then the actions.
 * md+ the page keeps the full period rollup - this list never shows there.
 */
export function StatementCards({
  statements,
  canConfirm,
  empty
}: {
  statements: StatementListRow[];
  /** Convenience only - the action re-checks permissions server-side */
  canConfirm: boolean;
  empty: string;
}) {
  return (
    <div className="grid gap-3 md:hidden">
      {statements.length === 0 && (
        <p className="panel px-4 py-6 text-center text-[13px] text-muted-foreground">
          {empty}
        </p>
      )}
      {statements.map(s => {
        const pay = Number(s.total_pay) + Number(s.total_custom_fees);
        const fees = Number(s.total_custom_fees);
        const drifted =
          s.status === "DONE" && Number(s.live_pay) !== Number(s.total_pay);
        return (
          <article key={s.id} className="panel">
            <div className="px-4 pt-3.5 pb-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-semibold">
                  {shortPeriod(s.period_start, s.period_end)}
                </span>
                {s.status && (
                  <StatementStatusBadge
                    status={s.status}
                    edited={s.edited_after_verify}
                  />
                )}
              </div>
              <p className="m-0 mt-1.5 text-xs text-muted-foreground">
                {s.leg_count} 段 · {fmtMiles(s.total_miles)} mi · {s.trip_days} 天
                {s.trucks ? ` · 车号 ${s.trucks}` : ""}
              </p>
              {(s.edited_after_verify || drifted) && (
                <p className="m-0 mt-1.5 text-xs text-red-600">
                  {s.edited_after_verify ? "司机确认后行程有改动，请复核；" : ""}
                  {drifted ? `实时工资 ${money(s.live_pay)}` : ""}
                </p>
              )}
            </div>
            <div className="flex items-end justify-between gap-3 bg-navy px-4 py-3">
              <span className="text-xs text-slate-400">
                本期应付
                {fees !== 0 && (
                  <span className="ml-1.5 text-[11px]">
                    （含费用 {money(s.total_custom_fees)}）
                  </span>
                )}
              </span>
              <strong className="font-mono text-2xl leading-none font-semibold text-amber tabular-nums">
                {money(String(pay))}
              </strong>
            </div>
            <div className="flex gap-2.5 px-4 py-3">
              <Link
                href={`/dashboard/trips/${s.driver_id}?period=${s.period_start}`}
                className="button button-quiet h-11 flex-1 text-[15px]"
              >
                查看详情
              </Link>
              {canConfirm && s.id && s.status === "VERIFIED" && (
                <ConfirmCardButton statementId={s.id} />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
