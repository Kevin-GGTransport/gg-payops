import { cn } from "@/lib/utils";
import {
  DRIVER_TYPE_LABELS,
  LOCATION_TYPE_LABELS,
  RECORD_STATUS_LABELS,
  type DriverType,
  type LocationType,
  type OperationType,
  type RecordStatus
} from "@/lib/labels";

/* 钢印标签：方角、细描边、淡底 */
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
