"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ComboboxField } from "@/components/combobox-field";
import { SubmitButton } from "@/components/submit-button";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { FUEL_SHEET_COLUMNS, type StateOption } from "../../trip-entry-form";
import { saveStatementFuel } from "@/app/dashboard/payroll/actions";

/** One editor row's values (truckCode rides along as a hidden snapshot) */
export type FuelEditRow = {
  state: string;
  gallons: string;
  miles: string;
  amount: string;
  note: string;
  truckCode: string;
};

type FuelSlot = { id: number; value: FuelEditRow };

const EMPTY_ROW: FuelEditRow = {
  state: "",
  gallons: "",
  miles: "",
  amount: "",
  note: "",
  truckCode: ""
};

/** Stable empty row set (module scope: a fresh [] per render churns TanStack) */
const NO_ROWS: unknown[] = [];

const INITIAL_ROWS = 2;

/** Sheet-cell field style: h-8 sizing plus the ledger field look — black rule
 *  on white for typed cells (same constants as the legs sheet above); focus
 *  keeps the black rule, no blue flip */
const cellInput =
  "h-8 px-2 border-foreground bg-card text-[13px] focus-visible:border-foreground";
/** Picker-trigger companion: same black rule, pale route fill marks the
 *  state dropdown against the white typed fields */
const cellPick = "border-foreground bg-route/10 hover:bg-route/20 data-[state=open]:bg-route/20";

function toSlots(rows: FuelEditRow[] | undefined, defaultTruckCode: string): FuelSlot[] {
  const source = rows && rows.length > 0 ? rows : [];
  const slots = source.map((value, i) => ({
    id: i + 1,
    value: { ...value, truckCode: value.truckCode || defaultTruckCode }
  }));
  if (slots.length === 0) {
    return Array.from({ length: INITIAL_ROWS }, (_, i) => ({
      id: i + 1,
      value: { ...EMPTY_ROW, truckCode: defaultTruckCode }
    }));
  }
  return slots;
}

/**
 * Fuel-by-state editor on the statement detail sheet - the same grid family
 * as the legs sheet above it (shared TanStack shell + cell sizing). Values
 * live in this component's state (no draft: a failed save refills through
 * URL params); submitting replaces the statement's whole fuel set, including
 * clearing it, with the same lifecycle rules as the entry sheet.
 */
export function FuelEditor({
  driverId,
  periodStart,
  states,
  rows,
  defaultTruckCode,
  frozen
}: {
  driverId: string;
  periodStart: string;
  states: StateOption[];
  /** Stored fuel rows (or URL refill after a failed save) */
  rows: FuelEditRow[];
  /** Truck snapshot for new rows (the statement's own truck annotation) */
  defaultTruckCode: string;
  /** VERIFIED statement: edits land with the permanent red flag */
  frozen: boolean;
}) {
  const [slots, setSlots] = React.useState<FuelSlot[]>(() =>
    toSlots(rows, defaultTruckCode)
  );
  const fuelTable = useRosterTable({
    data: NO_ROWS,
    columns: FUEL_SHEET_COLUMNS,
    storageKey: "payops.detail.fuel.cols"
  });

  const patch = React.useCallback((rowId: number, part: Partial<FuelEditRow>) => {
    setSlots(current =>
      current.map(slot =>
        slot.id === rowId ? { ...slot, value: { ...slot.value, ...part } } : slot
      )
    );
  }, []);

  const removeRow = React.useCallback((rowId: number) => {
    setSlots(current => current.filter(slot => slot.id !== rowId));
  }, []);

  function addRow() {
    const id = slots.reduce((max, slot) => Math.max(max, slot.id), 0) + 1;
    setSlots(current => [...current, { id, value: { ...EMPTY_ROW, truckCode: defaultTruckCode } }]);
  }

  // Dup hints and totals derive off the slots in this render (single frame)
  const content = slots.filter(s => Boolean(
    s.value.state || s.value.gallons || s.value.miles || s.value.amount || s.value.note
  ));
  const dupOf = new Map<number, number>();
  {
    const firstByState = new Map<string, number>();
    slots.forEach((slot, i) => {
      const state = slot.value.state;
      if (!state) return;
      const first = firstByState.get(state);
      if (first === undefined) firstByState.set(state, i);
      else dupOf.set(slot.id, first);
    });
  }
  const totals = content.reduce(
    (acc, slot) => ({
      gallons: acc.gallons + (Number(slot.value.gallons) || 0),
      miles: acc.miles + (Number(slot.value.miles) || 0),
      amount: acc.amount + (Number(slot.value.amount) || 0)
    }),
    { gallons: 0, miles: 0, amount: 0 }
  );

  return (
    <form action={saveStatementFuel} aria-label="编辑按州加油">
      <input type="hidden" name="driver_id" value={driverId} />
      <input type="hidden" name="period" value={periodStart} />
      <input type="hidden" name="f_fuel_row_count" value={slots.length} />
      <RosterTable table={fuelTable}>
        <tbody className="tb-group">
          {slots.map((slot, i) => {
            const dup = dupOf.get(slot.id);
            const label = `加油第 ${i + 1} 行`;
            return (
              <tr key={slot.id}>
                <td className="ctr px-1.5 font-mono text-[12px] tabular-nums text-foreground">
                  {i + 1}
                </td>
                <td className="px-1.5">
                  <input type="hidden" name={`f_fuel_row_${i}_truck_code`} value={slot.value.truckCode} />
                  <ComboboxField
                    name={`f_fuel_row_${i}_state_code`}
                    value={slot.value.state}
                    placeholder="州"
                    searchPlaceholder="搜索缩写 / 州名"
                    mono
                    triggerLabelOnly
                    triggerClassName={`h-8 w-full px-2 ${cellPick}`}
                    aria-label={`${label}州`}
                    onValueChange={next => patch(slot.id, { state: next })}
                    options={states.map(s => ({ value: s.code, label: s.code, description: s.name }))}
                  />
                  {dup !== undefined && (
                    <span className="block text-[10px] leading-tight font-normal text-amber-600">
                      与第 {dup + 1} 行重复，保存时合并
                    </span>
                  )}
                </td>
                <td className="px-1.5">
                  <Input
                    type="number" name={`f_fuel_row_${i}_gallons`} min={0} step={0.001}
                    value={slot.value.gallons}
                    onChange={e => patch(slot.id, { gallons: e.target.value })}
                    placeholder="—" aria-label={`${label}加仑`}
                    className={`${cellInput} font-mono`}
                  />
                </td>
                <td className="px-1.5">
                  <Input
                    type="number" name={`f_fuel_row_${i}_miles`} min={0} step={0.1}
                    value={slot.value.miles}
                    onChange={e => patch(slot.id, { miles: e.target.value })}
                    placeholder="—" aria-label={`${label}里程`}
                    className={`${cellInput} font-mono`}
                  />
                </td>
                <td className="px-1.5">
                  <Input
                    type="number" name={`f_fuel_row_${i}_amount`} min={0} step={0.01}
                    value={slot.value.amount}
                    onChange={e => patch(slot.id, { amount: e.target.value })}
                    placeholder="—" aria-label={`${label}金额`}
                    className={`${cellInput} font-mono`}
                  />
                </td>
                <td className="px-1.5">
                  <Input
                    name={`f_fuel_row_${i}_note`} maxLength={200}
                    value={slot.value.note}
                    onChange={e => patch(slot.id, { note: e.target.value })}
                    placeholder="选填" aria-label={`${label}备注`}
                    className={cellInput}
                  />
                </td>
                <td className="actions px-1.5">
                  {slots.length > 1 && (
                    <button
                      type="button"
                      className="linklike danger"
                      onClick={() => removeRow(slot.id)}
                    >
                      删除
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {content.length > 0 && (
            <tr className="font-medium">
              <td className="px-1.5 py-2" colSpan={2}>
                合计
              </td>
              <td className="px-1.5 py-2 font-mono tabular-nums">
                {totals.gallons.toLocaleString("en-US", { maximumFractionDigits: 3 })}
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
          添加州
        </button>
        <SubmitButton className="h-8 px-4" pendingLabel="保存中…">
          保存加油
        </SubmitButton>
        {frozen && content.length > 0 && (
          <span className="text-[11px] text-muted-foreground">核对后修改，计入标红</span>
        )}
      </div>
    </form>
  );
}
