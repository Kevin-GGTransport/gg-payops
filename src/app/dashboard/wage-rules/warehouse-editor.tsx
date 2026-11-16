"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/form-fields";
import { saveWarehousePrices } from "./actions";

export type WarehouseRow = {
  id: string;
  code: string;
  amazon_class: "A" | "B" | null;
  standard_pay_amount: string;
};

const cellInput =
  "h-8 border-0 bg-transparent px-2 shadow-none rounded-none text-[13px] focus-visible:ring-1";
const cellSelect =
  "h-8 border-0 bg-transparent px-1.5 shadow-none rounded-none text-[13px] focus-visible:ring-1 cursor-pointer";

const CLASS_OPTIONS = [
  { value: "", label: "未分类" },
  { value: "A", label: "A类" },
  { value: "B", label: "B类" }
] as const;

/**
 * Amazon warehouse dictionary prices: the round-trip standard pay (BASE legs
 * bill half per leg) and the A/B class that route matchers key on. These are
 * dictionary values written straight to ops.locations, not versioned pricing.
 */
export function WarehouseEditor({ warehouses }: { warehouses: WarehouseRow[] }) {
  const [rows, setRows] = React.useState<WarehouseRow[]>(warehouses);

  const update = (i: number, patch: Partial<WarehouseRow>) =>
    setRows(current => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form action={saveWarehousePrices} aria-label="仓库标准价">
      <input type="hidden" name="warehouse_count" value={rows.length} />
      <div className="grid gap-5 px-4 py-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            仓库标准价（基地往返一趟的司机价，BASE 腿按其 50% 计价）与 A/B 类标记
          </p>
          <table>
            <thead>
              <tr>
                <th>仓库</th>
                <th>类别</th>
                <th className="num">标准价 ($)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id}>
                  <td>
                    <input type="hidden" name={`warehouse_${i}_id`} value={row.id} />
                    <span className="mono px-2 text-[13px] font-semibold text-route">{row.code}</span>
                  </td>
                  <td>
                    <select
                      name={`warehouse_${i}_amazon_class`}
                      value={row.amazon_class ?? ""}
                      onChange={e =>
                        update(i, {
                          amazon_class: e.target.value === "A" || e.target.value === "B" ? e.target.value : null
                        })
                      }
                      aria-label={`${row.code} 类别`}
                      className={cellSelect}
                    >
                      {CLASS_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Input
                      type="number"
                      name={`warehouse_${i}_standard_pay`}
                      min={0}
                      step={0.01}
                      value={row.standard_pay_amount}
                      onChange={e => update(i, { standard_pay_amount: e.target.value })}
                      aria-label={`${row.code} 标准价`}
                      className={`${cellInput} w-28 text-right font-mono`}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty">暂无 Amazon 仓库，先到位置管理建档</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex justify-end border-t border-line px-4 py-3">
        <SubmitButton>保存仓库价</SubmitButton>
      </div>
    </form>
  );
}
