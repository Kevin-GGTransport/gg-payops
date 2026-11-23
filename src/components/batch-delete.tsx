"use client";

import { useEffect, useState } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteTripsBatch } from "@/app/dashboard/trips/actions";
import { submitWithToast } from "@/lib/submit-action";

/** 行程台账批量删除：实时显示选中数，确认弹窗后调服务端 action */
export function BatchDeleteTrips({ returnTo }: { returnTo: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () =>
      setCount(document.querySelectorAll<HTMLInputElement>('input[name="selected"]:checked').length);
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, []);

  return (
    <ConfirmAction
      danger
      title={`删除选中的 ${count} 条行程？`}
      description="删除后这些行程将从台账与工资单中移除，不可恢复。"
      confirmLabel="删除"
      pendingLabel="删除中…"
      trigger={props => (
        <button
          {...props}
          className="button button-quiet button-danger"
          disabled={count === 0}
        >
          {count > 0 ? `批量删除（${count}）` : "批量删除"}
        </button>
      )}
      onConfirm={async () => {
        const checked = document.querySelectorAll<HTMLInputElement>('input[name="selected"]:checked');
        if (checked.length === 0) return;
        const formData = new FormData();
        for (const box of checked) formData.append("selected", box.value);
        formData.set("return_to", returnTo);
        await submitWithToast(formData, deleteTripsBatch, {
          success: `已删除 ${checked.length} 条行程`,
          failure: "批量删除失败，请重试"
        });
      }}
    />
  );
}
