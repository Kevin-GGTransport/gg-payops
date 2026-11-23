"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ComboboxField } from "@/components/combobox-field";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { FUEL_SHEET_COLUMNS, type StateOption } from "../../trip-entry-form";
import { useSheetReport } from "./statement-sheet";

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
 * One fuel row, memoized: any keystroke used to re-render every row's picker.
 * Props are stable identities except the edited row's own value slice, so a
 * keystroke reconciles only that row.
 */
const FuelEditorRow = React.memo(function FuelEditorRow({
  index,
  rowId,
  value,
  dup,
  mark,
  removable,
  stateOptions,
  onPatch,
  onRemove
}: {
  index: number;
  rowId: number;
  value: FuelEditRow;
  /** Row number of the first row sharing this state (dup hint), if any */
  dup: number | undefined;
  /** Post-verify snapshot diff, drives the red tint + tag */
  mark: "added" | "changed" | null;
  removable: boolean;
  stateOptions: ReadonlyArray<{ value: string; label: string; description?: string }>;
  onPatch: (rowId: number, part: Partial<FuelEditRow>) => void;
  onRemove: (rowId: number) => void;
}) {
  const label = `加油第 ${index + 1} 行`;
  return (
    <tr className={mark ? "bg-red-50/40" : undefined}>
      <td className="ctr px-1.5 font-mono text-[12px] tabular-nums text-foreground">
        {index + 1}
        {mark && (
          <span className="block text-[9px] leading-tight text-red-700">
            {mark === "added" ? "核对后新增" : "核对后已改"}
          </span>
        )}
      </td>
      <td className="px-1.5">
        <input type="hidden" name={`f_fuel_row_${index}_truck_code`} value={value.truckCode} />
        <ComboboxField
          name={`f_fuel_row_${index}_state_code`}
          value={value.state}
          placeholder="州"
          searchPlaceholder="搜索缩写 / 州名"
          mono
          triggerLabelOnly
          triggerClassName={`h-8 w-full px-2 ${cellPick}`}
          aria-label={`${label}州`}
          onValueChange={next => onPatch(rowId, { state: next })}
          options={stateOptions}
        />
        {dup !== undefined && (
          <span className="block text-[10px] leading-tight font-normal text-amber-600">
            与第 {dup + 1} 行重复，保存时合并
          </span>
        )}
      </td>
      <td className="px-1.5">
        <Input
          type="number" name={`f_fuel_row_${index}_gallons`} min={0} step={0.001}
          value={value.gallons}
          onChange={e => onPatch(rowId, { gallons: e.target.value })}
          placeholder="—" aria-label={`${label}加仑`}
          className={`${cellInput} font-mono`}
        />
      </td>
      <td className="px-1.5">
        <Input
          type="number" name={`f_fuel_row_${index}_miles`} min={0} step={0.1}
          value={value.miles}
          onChange={e => onPatch(rowId, { miles: e.target.value })}
          placeholder="—" aria-label={`${label}里程`}
          className={`${cellInput} font-mono`}
        />
      </td>
      <td className="px-1.5">
        <Input
          type="number" name={`f_fuel_row_${index}_amount`} min={0} step={0.01}
          value={value.amount}
          onChange={e => onPatch(rowId, { amount: e.target.value })}
          placeholder="—" aria-label={`${label}金额`}
          className={`${cellInput} font-mono`}
        />
      </td>
      <td className="px-1.5">
        <Input
          name={`f_fuel_row_${index}_note`} maxLength={200}
          value={value.note}
          onChange={e => onPatch(rowId, { note: e.target.value })}
          placeholder="选填" aria-label={`${label}备注`}
          className={cellInput}
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
 * Fuel-by-state editor on the statement detail sheet - the same grid family
 * as the legs sheet above it (shared TanStack shell + cell sizing). Values
 * live in this component's state (no draft: a failed save refills through
 * URL params); submitting replaces the statement's whole fuel set, including
 * clearing it, with the same lifecycle rules as the entry sheet.
 */
export function FuelEditor({
  states,
  rows,
  defaultTruckCode,
  markings
}: {
  states: StateOption[];
  /** Stored fuel rows (or URL refill after a failed save) */
  rows: FuelEditRow[];
  /** Truck snapshot for new rows (the statement's own truck annotation) */
  defaultTruckCode: string;
  /** Verification-snapshot diff: state codes changed / added after verify */
  markings?: { changed: string[]; added: string[] };
}) {
  const [slots, setSlots] = React.useState<FuelSlot[]>(() =>
    toSlots(rows, defaultTruckCode)
  );
  const fuelTable = useRosterTable({
    data: NO_ROWS,
    columns: FUEL_SHEET_COLUMNS,
    storageKey: "payops.detail.fuel.cols"
  });

  // Any change reports to the enclosing sheet form's save bar
  const sheet = useSheetReport();

  const patch = React.useCallback((rowId: number, part: Partial<FuelEditRow>) => {
    sheet?.touch("fuel");
    setSlots(current =>
      current.map(slot =>
        slot.id === rowId ? { ...slot, value: { ...slot.value, ...part } } : slot
      )
    );
  }, [sheet]);

  const removeRow = React.useCallback((rowId: number) => {
    sheet?.touch("fuel");
    setSlots(current => current.filter(slot => slot.id !== rowId));
  }, [sheet]);

  function addRow() {
    sheet?.touch("fuel");
    const id = slots.reduce((max, slot) => Math.max(max, slot.id), 0) + 1;
    setSlots(current => [...current, { id, value: { ...EMPTY_ROW, truckCode: defaultTruckCode } }]);
  }

  // Stable options identity for the memoized state picker rows
  const stateOptions = React.useMemo(
    () => states.map(s => ({ value: s.code, label: s.code, description: s.name })),
    [states]
  );

  // Dup hints and totals derive off the slots in this render (single frame);
  // post-verify change marks come in as plain lookups (render-derived)
  const changedStates = new Set(markings?.changed ?? []);
  const addedStates = new Set(markings?.added ?? []);
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
    <div>
      <input type="hidden" name="f_fuel_row_count" value={slots.length} />
      <RosterTable table={fuelTable}>
        <tbody className="tb-group">
          {slots.map((slot, i) => (
            <FuelEditorRow
              key={slot.id}
              index={i}
              rowId={slot.id}
              value={slot.value}
              dup={dupOf.get(slot.id)}
              mark={
                addedStates.has(slot.value.state)
                  ? "added"
                  : changedStates.has(slot.value.state)
                    ? "changed"
                    : null
              }
              removable={slots.length > 1}
              stateOptions={stateOptions}
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
      </div>
    </div>
  );
}
