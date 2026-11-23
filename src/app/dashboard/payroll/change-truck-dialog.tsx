"use client";

import * as React from "react";

import { ComboboxField } from "@/components/combobox-field";
import { DialogFormFooter, SessionActionDialog } from "@/components/statement-action-dialog";
import { isRedirectError } from "@/lib/action-result";
import type { StatementStatus } from "@/lib/labels";
import { shortPeriod } from "@/lib/format";
import { changeStatementTruck, type ChangeTruckErrorCode } from "./actions";
import type { CopyTruckOption } from "./copy-statement-dialog";

/** The statement facts the dialog needs from the host detail sheet */
export type ChangeTruckStatement = {
  id: string;
  full_name: string;
  period_start: string;
  period_end: string;
  status: StatementStatus;
  leg_count: number;
  /** Comma-joined distinct truck codes of the period ("" when none) */
  trucks: string;
};

const CHANGE_TRUCK_ERROR_MESSAGES: Record<ChangeTruckErrorCode, string> = {
  bad_request: "参数缺失，请刷新页面后重试。",
  forbidden: "你的账号没有更换车辆的权限。",
  statement_missing: "工资单不存在或已被删除。",
  truck_missing: "所选车辆不存在或已停用。",
  no_trips: "本周期没有行程可改。"
};

/**
 * Re-stamp a statement's whole period onto a different truck (the wrong-truck
 * fix: entry picked the wrong one and the whole week follows it). Submission
 * calls the action imperatively: a refusal maps its error code to a Chinese
 * message that stays in the dialog, a success redirects back to the sheet
 * with the shared saved toast. VERIFIED sheets may change trucks too, with an
 * up-front red note that they will be flagged. The shared SessionActionDialog
 * owns the open/close/session skeleton.
 */
export function ChangeTruckButton({
  statement,
  trucks,
  returnTo,
  triggerClassName = "linklike",
  triggerLabel = "改车号"
}: {
  statement: ChangeTruckStatement;
  trucks: CopyTruckOption[];
  /** Full path the action redirects back to (with ?period=) */
  returnTo: string;
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  return (
    <SessionActionDialog
      ariaLabel="改车号"
      title={
        <>
          改车号 · {statement.full_name}（
          {shortPeriod(statement.period_start, statement.period_end)}）
        </>
      }
      triggerLabel={triggerLabel}
      triggerClassName={triggerClassName}
    >
      {close => (
        <ChangeTruckForm
          statement={statement}
          trucks={trucks}
          returnTo={returnTo}
          onClose={close}
        />
      )}
    </SessionActionDialog>
  );
}

function ChangeTruckForm({
  statement,
  trucks,
  returnTo,
  onClose
}: {
  statement: ChangeTruckStatement;
  trucks: CopyTruckOption[];
  returnTo: string;
  onClose: () => void;
}) {
  // Default to the current truck when the period ran exactly one and it is
  // still active; a multi-truck period has no obvious default and a
  // deactivated truck cannot be pre-picked
  const [truckId, setTruckId] = React.useState(() => {
    const codes = statement.trucks.split(",").map(s => s.trim()).filter(Boolean);
    if (codes.length !== 1) return "";
    return trucks.find(t => t.truck_code === codes[0])?.id ?? "";
  });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const truckOptions = React.useMemo(
    () =>
      trucks.map(t => ({
        value: t.id,
        label: t.truck_code,
        description: t.plate_no ?? undefined
      })),
    [trucks]
  );

  function submit() {
    setError(null);
    setPending(true);
    const fd = new FormData();
    fd.set("id", statement.id);
    fd.set("target_truck_id", truckId);
    fd.set("return_to", returnTo);
    changeStatementTruck(fd)
      .then(res => {
        // res === undefined means the action resolved without redirect (should
        // not happen - success redirects); a failed validation returns a code
        if (res && !res.ok) setError(CHANGE_TRUCK_ERROR_MESSAGES[res.code]);
      })
      .catch(error => {
        // Success redirects back to this sheet with the saved toast, which
        // rejects with NEXT_REDIRECT - that's the success path, not an error
        if (!isRedirectError(error)) setError("操作失败，请重试。");
      })
      .finally(() => setPending(false));
  }

  return (
    <div className="grid gap-4 px-5 pt-4 pb-5">
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        当前车号：{statement.trucks || "未登记"}。将把本周期 {statement.leg_count} 段行程的车号
        全部改为所选车号；日期、金额等其他内容不变。
      </p>
      <ComboboxField
        label="新车号"
        name="target_truck_id"
        value={truckId}
        onValueChange={setTruckId}
        clearable={false}
        mono
        placeholder="选新车号"
        options={truckOptions}
      />
      {statement.status === "VERIFIED" && (
        <p className="text-xs leading-relaxed text-red-700">
          本周期已核对：改车号后工资单将标红（核对金额保持不变），请留意复核提示。
        </p>
      )}
      {error && <p className="text-xs leading-relaxed text-red-700">{error}</p>}
      <DialogFormFooter
        pending={pending}
        canConfirm={Boolean(truckId)}
        confirmLabel="确认修改"
        pendingLabel="修改中…"
        onCancel={onClose}
        onConfirm={submit}
      />
    </div>
  );
}
