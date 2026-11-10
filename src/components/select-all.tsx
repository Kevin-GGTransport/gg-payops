"use client";

import { useEffect, useRef } from "react";

/** 表头全选：勾选/取消本表所有行复选框，并跟随行勾选联动全选/半选态 */
export function SelectAll() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const table = ref.current?.closest("table");
    if (!table) return;
    const sync = () => {
      const boxes = [...table.querySelectorAll<HTMLInputElement>('tbody input[name="selected"]')];
      const checked = boxes.filter(box => box.checked).length;
      if (!ref.current) return;
      ref.current.checked = boxes.length > 0 && checked === boxes.length;
      ref.current.indeterminate = checked > 0 && checked < boxes.length;
    };
    table.addEventListener("change", sync);
    return () => table.removeEventListener("change", sync);
  }, []);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="row-check"
      aria-label="全选本页"
      onChange={event => {
        const table = event.currentTarget.closest("table");
        if (!table) return;
        for (const box of table.querySelectorAll<HTMLInputElement>('tbody input[name="selected"]')) {
          box.checked = event.currentTarget.checked;
        }
      }}
    />
  );
}
