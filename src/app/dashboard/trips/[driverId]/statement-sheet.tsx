"use client";

import * as React from "react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/submit-button";
import type { StateOption } from "../../trip-entry-form";
import { saveStatementSheet } from "../actions";

/**
 * One form, one save: the detail sheet's three editable sections (legs,
 * fuel-by-state, custom fees) submit together through saveStatementSheet.
 * The sections keep their own state behind memo walls and report dirtiness
 * upward through this context (same documented deviation as the legs table's
 * onValues lifting); the save bar derives its hint and gating off the counts
 * in one render.
 */
type SheetReport = {
  /** Legs table: how many stored rows are dirty + how many appended rows carry content */
  reportLegs: (dirty: number, newRows: number) => void;
  /** Fuel / fee editors: any change at all (content compares equal to a no-op write) */
  touch: (section: "fuel" | "fees") => void;
};

const SheetDirtyContext = React.createContext<SheetReport | null>(null);

/** Context bridge for the nested client editors (fuel / fee / legs) */
export function useSheetReport() {
  return React.useContext(SheetDirtyContext);
}

export function StatementSheetForm({
  driverId,
  periodStart,
  returnTo,
  frozen,
  states,
  children
}: {
  driverId: string;
  periodStart: string;
  returnTo: string;
  /** VERIFIED statement: saves flag the sheet, numbers stay frozen */
  frozen: boolean;
  /** USPS dictionary for the client-side fuel-state pre-check */
  states: StateOption[];
  children: React.ReactNode;
}) {
  const [legDirty, setLegDirty] = React.useState(0);
  const [newRows, setNewRows] = React.useState(0);
  const [fuelTouched, setFuelTouched] = React.useState(false);
  const [feesTouched, setFeesTouched] = React.useState(false);

  // Stable identity so consuming editors' memo walls hold
  const report = React.useMemo<SheetReport>(
    () => ({
      reportLegs: (dirty, rows) => {
        setLegDirty(dirty);
        setNewRows(rows);
      },
      touch: section => {
        if (section === "fuel") setFuelTouched(true);
        else setFeesTouched(true);
      }
    }),
    []
  );

  const unsavedParts = [
    legDirty > 0 ? `${legDirty} 段已修改` : null,
    newRows > 0 ? `${newRows} 行新行程` : null,
    fuelTouched ? "加油有改动" : null,
    feesTouched ? "费用有改动" : null
  ].filter(Boolean);
  const hasUnsaved = unsavedParts.length > 0;

  // Pre-flight the same checks the action enforces, straight off the form
  // DOM: a bad row blocks the submit with a toast instead of a redirect
  // round-trip (server validation remains the backstop)
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const value = (name: string) => {
      const el = form.elements.namedItem(name);
      return el instanceof HTMLInputElement ? el.value.trim() : "";
    };
    const validStates = new Set(states.map(s => s.code));
    const fuelCount = Number.parseInt(value("f_fuel_row_count"), 10) || 0;
    for (let i = 0; i < fuelCount; i++) {
      const p = `f_fuel_row_${i}_`;
      const stateCode = value(`${p}state_code`).toUpperCase();
      const has = Boolean(
        stateCode ||
          value(`${p}gallons`) ||
          value(`${p}miles`) ||
          value(`${p}amount`) ||
          value(`${p}note`)
      );
      if (!has) continue;
      if (!stateCode) {
        toast.error(`加油第 ${i + 1} 行未选择州`);
        event.preventDefault();
        return;
      }
      if (!validStates.has(stateCode)) {
        toast.error(`加油第 ${i + 1} 行的州不在字典中，请重新选择`);
        event.preventDefault();
        return;
      }
    }
    const feeCount = Number.parseInt(value("f_fee_row_count"), 10) || 0;
    for (let i = 0; i < feeCount; i++) {
      const p = `f_fee_row_${i}_`;
      const label = value(`${p}label`);
      if (!label && (value(`${p}amount`) || value(`${p}note`))) {
        toast.error(`费用第 ${i + 1} 行未填写名称`);
        event.preventDefault();
        return;
      }
    }
  };

  return (
    <SheetDirtyContext.Provider value={report}>
      <form action={saveStatementSheet} aria-label="编辑周期工资单" onSubmit={onSubmit}>
        <input type="hidden" name="driver_id" value={driverId} />
        <input type="hidden" name="period" value={periodStart} />
        <input type="hidden" name="return_to" value={returnTo} />
        {children}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-card px-4 py-3">
          <span className="text-[13px] text-muted-foreground">
            {hasUnsaved ? `${unsavedParts.join(" · ")}未保存` : "行程、加油、费用一次保存"}
            {frozen && hasUnsaved && (
              <span className="text-red-700">
                {" "}· 本周期已核对：保存不会改动核对工资，行程/加油改动将标红，费用净额照常更新
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {hasUnsaved && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => window.location.reload()}
              >
                放弃修改
              </button>
            )}
            <SubmitButton className="button button-dark" disabled={!hasUnsaved} pendingLabel="保存中…">
              保存修改
              {legDirty > 0 && newRows > 0 && `（${legDirty} 段 + ${newRows} 新行）`}
              {legDirty > 0 && newRows === 0 && `（${legDirty} 段）`}
              {legDirty === 0 && newRows > 0 && `（${newRows} 新行）`}
              {legDirty === 0 && newRows === 0 && hasUnsaved && "（加油/费用）"}
            </SubmitButton>
          </div>
        </div>
      </form>
    </SheetDirtyContext.Provider>
  );
}
