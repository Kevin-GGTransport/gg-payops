"use client";

import { useEffect, useState, useTransition } from "react";
import { deleteTripsBatch } from "@/app/dashboard/trips/actions";

/** 行程台账批量删除：实时显示选中数，确认后调服务端 action */
export function BatchDeleteTrips({ returnTo }: { returnTo: string }) {
  const [pending, startTransition] = useTransition();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () =>
      setCount(document.querySelectorAll<HTMLInputElement>('input[name="selected"]:checked').length);
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, []);

  return (
    <button
      type="button"
      className="button button-quiet button-danger"
      disabled={pending || count === 0}
      onClick={() => {
        const checked = document.querySelectorAll<HTMLInputElement>('input[name="selected"]:checked');
        if (checked.length === 0) return;
        if (!confirm(`确定删除选中的 ${checked.length} 条行程？`)) return;
        const formData = new FormData();
        for (const box of checked) formData.append("selected", box.value);
        formData.set("return_to", returnTo);
        startTransition(async () => {
          await deleteTripsBatch(formData);
        });
      }}
    >
      {pending ? "删除中…" : count > 0 ? `批量删除（${count}）` : "批量删除"}
    </button>
  );
}
