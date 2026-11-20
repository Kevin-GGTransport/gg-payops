import { cn } from "@/lib/utils";
import {
  DRIVER_TYPE_LABELS,
  LOCATION_TYPE_LABELS,
  RECORD_STATUS_LABELS,
  STATEMENT_STATUS_LABELS,
  type DriverType,
  type LocationType,
  type OperationType,
  type RecordStatus,
  type StatementStatus
} from "@/lib/labels";

/* Stamp-style label: square corners, thin outline, pale fill */
const pillBase = "inline-flex items-center rounded-[3px] border px-1.5 py-px text-[11px] font-semibold leading-4";
const tagBase = pillBase;

export function DriverTypeBadge({ type }: { type: DriverType }) {
  return (
    <span className={cn(pillBase, type === "DRIVER" ? "border-route/30 bg-route/10 text-route" : "border-amber-500/40 bg-amber-50 text-amber-800")}>
      {DRIVER_TYPE_LABELS[type]}
    </span>
  );
}

const LOC_STYLES: Record<LocationType, string> = {
  BASE: "border-slate-300 bg-slate-100 text-slate-700",
  AMAZON: "border-route/30 bg-route/10 text-route",
  OTHER: "border-line bg-muted text-muted-foreground"
};

export function LocationTypeBadge({ type }: { type: LocationType }) {
  return <span className={cn(tagBase, LOC_STYLES[type])}>{LOCATION_TYPE_LABELS[type]}</span>;
}

export function StatusPill({ status }: { status: RecordStatus }) {
  return (
    <span className={cn(pillBase, status === "ACTIVE" ? "border-audit/30 bg-audit/10 text-audit" : "border-line bg-muted text-muted-foreground")}>
      {RECORD_STATUS_LABELS[status]}
    </span>
  );
}

/** 工资规则版本状态：已生效（audit 绿）/ 待生效（琥珀） */
export function WageRuleStateBadge({ effective, label }: { effective: boolean; label?: string }) {
  return (
    <span
      className={cn(
        pillBase,
        effective ? "border-audit/30 bg-audit/10 text-audit" : "border-amber-500/40 bg-amber-50 text-amber-800"
      )}
    >
      {label ?? (effective ? "已生效" : "待生效")}
    </span>
  );
}

/* Statement status: draft = gray, verified = green, driver-confirmed = red;
 * the edited variant renders on detail sheets only */
const STATEMENT_STYLES: Record<StatementStatus, string> = {
  DRAFT: "border-line bg-muted text-muted-foreground",
  VERIFIED: "border-audit/30 bg-audit/10 text-audit",
  DONE: "border-red-600/40 bg-red-50 text-red-700"
};

export function StatementStatusBadge({
  status,
  edited = false
}: {
  status: StatementStatus;
  /** Checked sheet + trips changed afterwards: detail pages render the red variant */
  edited?: boolean;
}) {
  const style = edited
    ? "border-red-600/40 bg-red-50 text-red-700"
    : STATEMENT_STYLES[status];
  return (
    <span className={cn(pillBase, style)}>
      {edited ? `${STATEMENT_STATUS_LABELS[status]} · 已改动` : STATEMENT_STATUS_LABELS[status]}
    </span>
  );
}

/** Known codes keep their house colors; dictionary additions get neutral ink */
const OP_STYLES: Partial<Record<string, string>> = {
  DEL: "border-route/30 bg-route/10 text-route",
  PU: "border-audit/30 bg-audit/10 text-audit",
  EMPTY: "border-slate-300 bg-slate-100 text-slate-600",
  BOBTAIL: "border-amber-500/40 bg-amber-50 text-amber-800"
};

export function OperationBadge({ operation }: { operation: OperationType }) {
  return (
    <span className={cn(tagBase, "font-mono tracking-wide", OP_STYLES[operation] ?? "border-line bg-muted text-muted-foreground")}>
      {operation}
    </span>
  );
}

/** 起终点对：两端同等重要，同一 route 蓝加粗，箭头弱化相连 */
export function RoutePair({ from, to }: { from: string | null; to: string | null }) {
  return (
    <>
      {from ? <span className="route-code">{from}</span> : "—"}
      {" "}
      <span className="route-arrow">→</span>{" "}
      {to ? <span className="route-code">{to}</span> : "—"}
    </>
  );
}

/** 打包标记：承价腿带金额标签（琥珀），$0 成员腿弱化显示「打包内」 */
export function PackageBadge({ note }: { note: string | null }) {
  return (
    <span
      className={cn(
        pillBase,
        note
          ? "border-amber-500/40 bg-amber-50 text-amber-800"
          : "border-line bg-muted text-muted-foreground"
      )}
    >
      {note ?? "打包内"}
    </span>
  );
}
