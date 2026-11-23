"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { FEE_SHEET_COLUMNS } from "../../trip-entry-form";
import { useSheetReport } from "./statement-sheet";

/** One editor row's values (miles is informational; amount ADDS to the payout) */
export type FeeEditRow = {
  label: string;
  amount: string;
  miles: string;
  note: string;
};

type FeeSlot = { id: number; value: FeeEditRow };

const EMPTY_ROW: FeeEditRow = { label: "", amount: "", miles: "", note: "" };

/** Stable empty row set (module scope: a fresh [] per render churns TanStack) */
const NO_ROWS: unknown[] = [];

/** Fees are far sparser than fuel - a fresh editor opens with one blank row */
const INITIAL_ROWS = 1;

/** Sheet-cell field style: same constants as the fuel editor above */
const cellInput =
  "h-8 px-2 border-foreground bg-card text-[13px] focus-visible:border-foreground";

function toSlots(rows: FeeEditRow[] | undefined): FeeSlot[] {
  const source = rows && rows.length > 0 ? rows : [];
  const slots = source.map((value, i) => ({
    id: i + 1,
    value: { label: value.label, amount: value.amount, miles: value.miles, note: value.note }
  }));
  if (slots.length === 0) {
    return Array.from({ length: INITIAL_ROWS }, (_, i) => ({
      id: i + 1,
      value: { ...EMPTY_ROW }
    }));
  }
  return slots;
}

/** One fee row, memoized so a keystroke reconciles only its own cells */
const FeeEditorRow = React.memo(function FeeEditorRow({
  index,
  rowId,
  value,
  removable,
  onPatch,
  onRemove
}: {
  index: number;
  rowId: number;
  value: FeeEditRow;
  removable: boolean;
  onPatch: (rowId: number, part: Partial<FeeEditRow>) => void;
  onRemove: (rowId: number) => void;
}) {
  const label = `费用第 ${index + 1} 行`;
  return (
    <tr>
      <td className="ctr px-1.5 font-mono text-[12px] tabular-nums text-foreground">
        {index + 1}
      </td>
      <td className="px-1.5">
        <Input
          name={`f_fee_row_${index}_label`}
          value={value.label}
          maxLength={60}
          placeholder="如 过路费 / 补贴"
          aria-label={`${label}名称`}
          className={cellInput}
          onChange={e => onPatch(rowId, { label: e.target.value })}
        />
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`f_fee_row_${index}_miles`}
          min={0}
          step={0.1}
          value={value.miles}
          placeholder="—"
          aria-label={`${label}里程`}
          className={`${cellInput} font-mono`}
          onChange={e => onPatch(rowId, { miles: e.target.value })}
        />
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`f_fee_row_${index}_amount`}
          min={0}
          step={0.01}
          value={value.amount}
          placeholder="—"
          aria-label={`${label}金额`}
          className={`${cellInput} font-mono`}
          onChange={e => onPatch(rowId, { amount: e.target.value })}
        />
      </td>
      <td className="px-1.5">
        <Input
          name={`f_fee_row_${index}_note`}
          value={value.note}
          maxLength={200}
          placeholder="选填"
          aria-label={`${label}备注`}
          className={cellInput}
          onChange={e => onPatch(rowId, { note: e.target.value })}
        />
      </td>
      <td className="actions px-1.5">
        {removable && (
          <button
            type="button"
            className="linklike danger"
            onClick={() => onRemove(rowId)}
          >
            删除
          </button>
        )}
      </td>
    </tr>
  );
});

/**
 * Custom-fee editor on the statement detail sheet - the same grid family as
 * the fuel editor above it. Values live in this component's state (no draft:
 * a failed save refills through URL params); the enclosing sheet form's one
 * save replaces the statement's whole fee set, including clearing it. Fees
 * sit outside the verification snapshot: no per-row red marks, a VERIFIED
 * statement only takes the permanent edited_after_verify flag.
 */
export function FeeEditor({
  rows
}: {
  /** Stored fee rows (or URL refill after a failed save) */
  rows: FeeEditRow[];
}) {
  const [slots, setSlots] = React.useState<FeeSlot[]>(() => toSlots(rows));
  const feeTable = useRosterTable({
    data: NO_ROWS,
    columns: FEE_SHEET_COLUMNS,
    storageKey: "payops.detail.fees.cols"
  });

  // Any change reports to the enclosing sheet form's save bar
  const sheet = useSheetReport();

  const patch = React.useCallback((rowId: number, part: Partial<FeeEditRow>) => {
    sheet?.touch("fees");
    setSlots(current =>
      current.map(slot =>
        slot.id === rowId ? { ...slot, value: { ...slot.value, ...part } } : slot
      )
    );
  }, [sheet]);

  const removeRow = React.useCallback((rowId: number) => {
    sheet?.touch("fees");
    setSlots(current => current.filter(slot => slot.id !== rowId));
  }, [sheet]);

  function addRow() {
    sheet?.touch("fees");
    const id = slots.reduce((max, slot) => Math.max(max, slot.id), 0) + 1;
    setSlots(current => [...current, { id, value: { ...EMPTY_ROW } }]);
  }

  // Content rows and totals derive off the slots in this render (single
  // frame); same-label rows are legitimate (two toll reimbursements in one
  // week), so unlike fuel there is no dup hint and no merge on save
  const content = slots.filter(s => Boolean(s.value.label || s.value.amount || s.value.miles || s.value.note));
  const totals = content.reduce(
    (acc, slot) => ({
      miles: acc.miles + (Number(slot.value.miles) || 0),
      amount: acc.amount + (Number(slot.value.amount) || 0)
    }),
    { miles: 0, amount: 0 }
  );

  return (
    <div>
      <input type="hidden" name="f_fee_row_count" value={slots.length} />
      <RosterTable table={feeTable}>
        <tbody className="tb-group">
          {slots.map((slot, i) => (
            <FeeEditorRow
              key={slot.id}
              index={i}
              rowId={slot.id}
              value={slot.value}
              removable={slots.length > 1}
              onPatch={patch}
              onRemove={removeRow}
            />
          ))}
          {content.length > 0 && (
            <tr className="font-medium">
              <td className="px-1.5 py-2" colSpan={2}>
                合计
              </td>
              <td className="px-1.5 py-2 font-mono tabular-nums">
                {totals.miles.toLocaleString("en-US", { maximumFractionDigits: 1 })}
              </td>
              <td className="px-1.5 py-2 font-mono tabular-nums">
                ${totals.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td colSpan={2} />
            </tr>
          )}
        </tbody>
      </RosterTable>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="linklike" onClick={addRow}>
          <PlusIcon className="mr-1 inline size-3.5" />
          添加费用
        </button>
      </div>
    </div>
  );
}
