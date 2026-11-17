"use client";

import * as React from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormGrid, SubmitButton, TextareaField } from "@/components/form-fields";
import { ComboboxField } from "@/components/combobox-field";
import { DateField } from "@/components/date-field";
import { LocationPicker, type LocationOption } from "@/components/location-picker";
import { Input } from "@/components/ui/input";
import { calcFuelSubsidy, calcTripWage, type WageRuleData } from "@/lib/wage";
import type { DriverType, OperationType } from "@/lib/labels";
import type { OperationOption } from "../trip-entry-form";
import type { TripEditRow } from "@/lib/queries/trips";
import { updateTrip } from "./actions";

/** Label + control + optional hint, the dialog counterpart of a sheet column */
function DialogField({
  label,
  hint,
  hintDanger = false,
  children
}: {
  label: string;
  hint?: string;
  hintDanger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
      {hint && (
        <span
          className={`text-[10px] leading-tight font-normal ${
            hintDanger ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

/** Dictionaries the edit form prices with; the host page passes them down once */
export type TripEditDictionaries = {
  locations: LocationOption[];
  operations: OperationOption[];
  wageRule: WageRuleData | null;
};

/**
 * Pure client-side edit dialog: no navigation, no URL state - the row's data
 * is already in memory, opening/closing is a local boolean. Field set and
 * behavior mirror a home-sheet entry row exactly: location pickers
 * (creatable + map), Google-measured miles on every endpoint change,
 * rule-priced wage with a sticky manual override. Saving goes through the
 * updateTrip server action, which redirects back to the list.
 */
export function TripEditDialog({
  trip,
  dictionaries,
  onClose,
  returnTo
}: {
  /** Null = closed; a change of id remounts the form with fresh state */
  trip: TripEditRow | null;
  dictionaries: TripEditDictionaries;
  onClose: () => void;
  /** Serialized filters the save redirects back to */
  returnTo: string;
}) {
  const { locations, operations, wageRule } = dictionaries;

  // Stored endpoint -> picker value: the loc: pick when the row is in the
  // dictionary, else txt:<code> (an INACTIVE location still resolves by code
  // server-side), else empty
  const endpointInitial = (locationId: string | null, code: string | null) => {
    if (locationId && locations.some(l => l.id === locationId)) return `loc:${locationId}`;
    return code ? `txt:${code}` : "";
  };

  return (
    <Dialog open={trip !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        aria-label="编辑行程"
        className="flex max-h-[90vh] flex-col overflow-hidden"
      >
        <DialogHeader className="mb-0 shrink-0 border-b border-dashed border-line px-5 pt-4 pb-3">
          <DialogTitle>
            {trip ? `编辑行程 · ${trip.driver_name ?? ""}（${trip.trip_date}）` : "编辑行程"}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {trip && (
            <EditForm
              key={trip.id}
              trip={trip}
              locations={locations}
              operations={operations}
              wageRule={wageRule}
              returnTo={returnTo}
              endpointInitial={endpointInitial}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type CalcStatus = "loading" | "auto" | "failed";

function EditForm({
  trip,
  locations,
  operations,
  wageRule,
  returnTo,
  endpointInitial
}: {
  trip: TripEditRow;
  locations: LocationOption[];
  operations: OperationOption[];
  wageRule: WageRuleData | null;
  returnTo: string;
  endpointInitial: (locationId: string | null, code: string | null) => string;
}) {
  const [dateValue, setDateValue] = React.useState(trip.trip_date);
  const [operation, setOperation] = React.useState(trip.operation);
  const operationRequiresLoad = (code: string) =>
    operations.find(o => o.code === code)?.requires_load ?? true;
  const [loadNoValue, setLoadNoValue] = React.useState(
    !operationRequiresLoad(trip.operation) ? "" : trip.load_no ?? ""
  );
  const [fromValue, setFromValue] = React.useState(() =>
    endpointInitial(trip.from_location_id, trip.from_code)
  );
  const [toValue, setToValue] = React.useState(() =>
    endpointInitial(trip.to_location_id, trip.to_code)
  );
  const [milesValue, setMilesValue] = React.useState(trip.miles || "0");
  // Fuel-up log (US gallons): optional ledger field, never priced - same as entry
  const [fuelValue, setFuelValue] = React.useState(trip.fuel_gallons ?? "");
  const [status, setStatus] = React.useState<CalcStatus>("loading");
  const [manual, setManual] = React.useState(false);
  // Ignore stale responses after a quick endpoint re-pick
  const requestId = React.useRef(0);

  // Sticky manual wage: the stored amount opens as the manual value (it was
  // priced at entry time and must not silently drift on open); hand edits
  // keep it, only 重算 drops back to following the rule
  const [manualPay, setManualPay] = React.useState<string | null>(trip.pay_amount || null);

  // Google-measured miles: every endpoint (re-)pick re-measures, exactly like
  // an entry row; a failed measurement keeps the stored value for hand edits
  React.useEffect(() => {
    if (!fromValue || !toValue) return;
    const id = ++requestId.current;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/distance?from=${encodeURIComponent(fromValue)}&to=${encodeURIComponent(toValue)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { miles: number | null } = await res.json();
        if (cancelled || id !== requestId.current) return;
        if (typeof data.miles === "number" && data.miles > 0) {
          setStatus("auto");
          setManual(false);
          setMilesValue(String(data.miles));
        } else {
          setStatus("failed");
        }
      } catch {
        if (!cancelled && id === requestId.current) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromValue, toValue]);

  // Free-text endpoints match no price rule (no location id) -> mileage tier
  const wageEndpoint = (value: string) =>
    locations.find(l => `loc:${l.id}` === value) ?? null;

  // Every trip prices by the single ACTIVE rule version
  const rule = wageRule;
  const autoPay = React.useMemo(
    () =>
      rule
        ? calcTripWage({
            driverId: trip.driver_id,
            driverType: (trip.driver_type ?? undefined) as DriverType | undefined,
            priceAsDriver: trip.price_as_driver,
            operation: (operation || undefined) as OperationType | undefined,
            miles: Number(milesValue) || 0,
            from: wageEndpoint(fromValue),
            to: wageEndpoint(toValue),
            rule
          })
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wageEndpoint closes over the stable locations prop
    [operation, milesValue, fromValue, toValue, rule]
  );

  const payValue = manualPay ?? autoPay.toFixed(2);

  // Owner fuel subsidy: derived from miles, read-only (the server re-snapshots
  // it on save at the then-current rate - never a submitted field)
  const subsidyRate = rule?.fuel_subsidy_rate ?? 0;
  const showSubsidy = trip.driver_type === "OWNER" && subsidyRate > 0;
  const subsidyValue = calcFuelSubsidy({
    driverType: trip.driver_type ?? undefined,
    miles: Number(milesValue) || 0,
    rate: subsidyRate
  }).toFixed(2);

  const phase = !fromValue || !toValue ? "idle" : status;
  const milesHint =
    phase === "loading"
      ? "测算中…"
      : manual
        ? "手动输入"
        : phase === "failed"
          ? "未能测算，请手填"
          : "";

  return (
    <form action={updateTrip} aria-label="行程编辑卡">
      <input type="hidden" name="id" value={trip.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <FormGrid>
        <DialogField label="日期">
          <DateField
            name="trip_date"
            value={dateValue}
            onValueChange={setDateValue}
            aria-label="行程日期"
          />
        </DialogField>
        <DialogField label="起点">
          <LocationPicker
            name="from_location"
            locations={locations}
            creatable
            value={fromValue}
            placeholder="起点"
            aria-label="行程起点"
            onValueChange={setFromValue}
          />
        </DialogField>
        <DialogField label="终点">
          <LocationPicker
            name="to_location"
            locations={locations}
            creatable
            value={toValue}
            placeholder="终点"
            aria-label="行程终点"
            onValueChange={setToValue}
          />
        </DialogField>
        <DialogField label="操作">
          <ComboboxField
            name="operation"
            defaultValue={operation}
            clearable={false}
            searchable={false}
            aria-label="行程操作"
            onValueChange={value => {
              setOperation(value);
              if (!operationRequiresLoad(value)) setLoadNoValue("");
            }}
            // Code-only labels keep the trigger narrow, same as entry rows
            options={operations.map(op => ({ value: op.code, label: op.code }))}
          />
        </DialogField>
        <DialogField label="Load#">
          <Input
            name="load_no"
            value={loadNoValue}
            onChange={e => setLoadNoValue(e.target.value)}
            disabled={!operationRequiresLoad(operation)}
            maxLength={64}
            placeholder={operationRequiresLoad(operation) ? "如 LD101" : "该操作免填"}
            aria-label="行程 Load#"
            className="font-mono font-semibold"
          />
        </DialogField>
        <DialogField label="里程 (mi)" hint={milesHint} hintDanger={phase === "failed"}>
          <Input
            type="number"
            name="miles"
            min={0}
            step={0.1}
            value={milesValue}
            onChange={e => {
              setMilesValue(e.target.value);
              setManual(true);
            }}
            aria-label="行程里程"
            className="text-right font-mono"
          />
        </DialogField>
        <DialogField label="加油 (gal)">
          <Input
            type="number"
            name="fuel_gallons"
            min={0}
            step={0.1}
            value={fuelValue}
            onChange={e => setFuelValue(e.target.value)}
            placeholder="—"
            aria-label="行程加油量"
            className="text-right font-mono"
          />
        </DialogField>
        {showSubsidy && (
          <DialogField
            label="燃油补助 ($)"
            hint={`里程 × $${subsidyRate}/mi · 保存时按当时费率重算`}
          >
            <Input
              readOnly
              value={subsidyValue}
              aria-label="行程燃油补助（只读）"
              className="bg-muted/50 text-right font-mono"
            />
          </DialogField>
        )}
        <DialogField
          label="本趟工资 ($)"
          hint={
            trip.package_id
              ? trip.package_note ?? "打包内 · $0（金额在承价腿上）"
              : manualPay !== null
                ? undefined // rendered inline below: the 重算 action lives in the hint slot
                : dateValue && !rule
                  ? "该日期无生效规则"
                  : undefined
          }
        >
          <>
            <Input
              type="number"
              name="pay_amount"
              min={0}
              step={0.01}
              value={payValue}
              onChange={e => setManualPay(e.target.value)}
              aria-label="行程本趟工资"
              className="text-right font-mono"
            />
            {manualPay !== null && (
              <span className="text-[10px] leading-tight font-normal text-muted-foreground">
                手动 ·{" "}
                <button type="button" className="linklike" onClick={() => setManualPay(null)}>
                  重算
                </button>
              </span>
            )}
          </>
        </DialogField>
        <TextareaField
          label="备注"
          name="notes"
          defaultValue={trip.notes ?? ""}
          className="col-span-2 max-md:col-span-1"
        />
      </FormGrid>
      <SubmitButton>保存修改</SubmitButton>
    </form>
  );
}
