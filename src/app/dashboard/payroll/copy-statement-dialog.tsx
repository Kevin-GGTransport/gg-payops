"use client";

import * as React from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ComboboxField } from "@/components/combobox-field";
import { DRIVER_TYPE_LABELS, type DriverType } from "@/lib/labels";
import { copyStatement, type CopyErrorCode } from "./actions";

/** Picker payloads pulled server-side by the host pages (same sources as entry) */
export type CopyDriverOption = {
  id: string;
  full_name: string;
  driver_type: DriverType;
  price_as_driver: boolean;
};
export type CopyTruckOption = {
  id: string;
  truck_code: string;
  plate_no: string | null;
  truck_type: string | null;
};

/** The source facts the dialog needs from a statement row */
export type CopySourceStatement = {
  id: string;
  driver_id: string;
  full_name: string;
  driver_type: DriverType;
  period_start: string;
  period_end: string;
  leg_count: number;
  /** Comma-joined distinct truck codes of the period ("" when none) */
  trucks: string;
};

const COPY_ERROR_MESSAGES: Record<CopyErrorCode, string> = {
  bad_request: "参数缺失，请刷新页面后重试。",
  no_trips: "源工资单本周期没有行程可复制。",
  source_not_draft: "源工资单已核对或不存在，只有草稿可以复制。",
  target_same: "不能复制给同一个人。",
  target_missing: "目标司机不存在或已停用。",
  target_verified: "目标该周期工资单已核对，不能复制入（改动只会标红）。",
  target_has_trips: "目标该周期已有行程，为避免重复计薪已阻止，请先处理目标名下的行程。"
};

function shortPeriod(start: string, end: string) {
  const fmt = (iso: string) => iso.slice(5).replace("-", "/");
  return `${fmt(start)} ~ ${fmt(end)}`;
}

/**
 * Copy a draft statement's whole leg set onto another driver. Submission calls
 * the copyStatement action imperatively (the VerifyStatementButton pattern):
 * a refusal maps its error code to a Chinese message that stays in the dialog,
 * a success redirects from inside the action to the target's detail sheet.
 * Amounts are copied verbatim; when source and target driver types differ
 * (owner pricing ≠ driver pricing) a red warning asks for a manual recheck.
 * Picks reset per open via the session key - no effects.
 */
export function CopyStatementButton({
  statement,
  drivers,
  trucks,
  triggerClassName = "linklike",
  triggerLabel = "复制"
}: {
  statement: CopySourceStatement;
  drivers: CopyDriverOption[];
  trucks: CopyTruckOption[];
  /** Row actions use linklike; the detail-sheet header uses button button-quiet */
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  // null = closed; every open bumps the number so the form remounts fresh
  const [session, setSession] = React.useState<number | null>(null);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setSession(s => (s ?? 0) + 1)}
      >
        {triggerLabel}
      </button>
      <Dialog
        open={session !== null}
        onOpenChange={open => {
          if (!open) setSession(null);
        }}
      >
        <DialogContent aria-label="复制工资单" className="max-h-[90vh]">
          <DialogHeader className="mb-0 border-b border-dashed border-line px-5 pt-4 pb-3">
            <DialogTitle>
              复制工资单 · {statement.full_name}（
              {shortPeriod(statement.period_start, statement.period_end)}）
            </DialogTitle>
          </DialogHeader>
          {session !== null && (
            <CopyForm
              key={session}
              statement={statement}
              drivers={drivers}
              trucks={trucks}
              onClose={() => setSession(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CopyForm({
  statement,
  drivers,
  trucks,
  onClose
}: {
  statement: CopySourceStatement;
  drivers: CopyDriverOption[];
  trucks: CopyTruckOption[];
  onClose: () => void;
}) {
  const [driverId, setDriverId] = React.useState("");
  // Truck defaults to the source statement's truck - usually the same truck
  // keeps hauling. A multi-truck period has no obvious default, and a truck
  // that is no longer active (absent from the options) cannot be pre-picked
  const [truckId, setTruckId] = React.useState(() => {
    const codes = statement.trucks.split(",").map(s => s.trim()).filter(Boolean);
    if (codes.length !== 1) return "";
    return trucks.find(t => t.truck_code === codes[0])?.id ?? "";
  });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const driverOptions = React.useMemo(
    () =>
      drivers
        .filter(d => d.id !== statement.driver_id)
        .map(d => ({
          value: d.id,
          label: d.full_name,
          group: DRIVER_TYPE_LABELS[d.driver_type],
          description: d.price_as_driver ? "计价按司机价" : undefined
        })),
    [drivers, statement.driver_id]
  );
  const truckOptions = React.useMemo(
    () =>
      trucks.map(t => ({
        value: t.id,
        label: t.truck_code,
        description: t.plate_no ?? undefined
      })),
    [trucks]
  );

  const targetType = drivers.find(d => d.id === driverId)?.driver_type;
  const typeWarning =
    targetType && targetType !== statement.driver_type
      ? `源是${DRIVER_TYPE_LABELS[statement.driver_type]}、目标是${DRIVER_TYPE_LABELS[targetType]}：价格规则不同（车主价通常为司机价的 2 倍），金额照抄后请逐段核对。`
      : null;

  function submit() {
    setError(null);
    setPending(true);
    const fd = new FormData();
    fd.set("id", statement.id);
    fd.set("target_driver_id", driverId);
    fd.set("target_truck_id", truckId);
    copyStatement(fd)
      .then(res => {
        if (res && !res.ok) setError(COPY_ERROR_MESSAGES[res.code]);
      })
      .catch(() => setError("操作失败，请重试。"))
      .finally(() => setPending(false));
  }

  return (
    <div className="grid gap-4 px-5 pt-4 pb-5">
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        将把 {statement.full_name} 本周期的 {statement.leg_count} 段行程复制给所选人；
        金额原样复制，燃油补助按目标司机重算，源工资单保持不变。
      </p>
      <ComboboxField
        label="复制给"
        name="target_driver_id"
        value={driverId}
        onValueChange={setDriverId}
        clearable={false}
        placeholder="选目标司机 / 车主"
        options={driverOptions}
      />
      <ComboboxField
        label="车号"
        name="target_truck_id"
        value={truckId}
        onValueChange={setTruckId}
        clearable={false}
        mono
        placeholder="选目标车号"
        options={truckOptions}
      />
      {typeWarning && <p className="text-xs leading-relaxed text-red-700">{typeWarning}</p>}
      {error && <p className="text-xs leading-relaxed text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="button button-quiet" disabled={pending} onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="button button-dark"
          disabled={!driverId || !truckId || pending}
          onClick={submit}
        >
          {pending ? "复制中…" : "复制"}
        </button>
      </div>
    </div>
  );
}
