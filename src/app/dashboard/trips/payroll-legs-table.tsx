"use client";

import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { ComboboxField } from "@/components/combobox-field";
import { ConfirmAction } from "@/components/confirm-action";
import { DateField } from "@/components/date-field";
import { Input } from "@/components/ui/input";
import { LocationPicker, type LocationOption } from "@/components/location-picker";
import { RosterTable, useRosterTable } from "@/components/roster-table";
import { fuel as fmtFuel, miles as fmtMiles, money } from "@/lib/format";
import { isRedirectError } from "@/lib/action-result";
import { calcFuelSubsidy, calcTripWage, type WageRuleData } from "@/lib/wage";
import type { OperationType } from "@/lib/labels";
import type { OperationOption } from "../trip-entry-form";
import type { DriverPeriodTripRow } from "@/lib/queries/trips";
import { deleteTrip } from "./actions";
import { useSheetReport } from "./[driverId]/statement-sheet";

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function dowOf(iso: string) {
  return DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

type DayGroup = {
  date: string;
  legs: DriverPeriodTripRow[];
  miles: number;
  fuel: number;
  pay: number;
  subsidy: number;
};

/** Dictionaries the inline grid prices with; the host page passes them down once */
export type TripEditDictionaries = {
  locations: LocationOption[];
  operations: OperationOption[];
  wageRule: WageRuleData | null;
};

/** Sheet-cell field style: h-8 sizing plus the ledger field look — black rule
 *  on white for typed cells (overrides the site-wide gray fill via twMerge).
 *  Focus keeps the black rule (the blue flip reads as a jolt; caret suffices) */
const cellInput = "h-8 px-2 border-foreground bg-card text-[13px] focus-visible:border-foreground";
/** Picker-trigger companion: same black rule, pale route fill marks
 *  choose-from-list cells; hover and open deepen the tint one step */
const cellPick = "border-foreground bg-route/10 hover:bg-route/20 data-[state=open]:bg-route/20";
/** DateField group variant of the typed-cell look */
const cellDate =
  "border-foreground bg-card has-[[data-slot=input-group-control]:focus-visible]:border-foreground";
/** Red variants mark cells changed after verification (plain class swaps -
 *  NOT appended - so the border color never depends on CSS order) */
const cellInputRed =
  "h-8 px-2 border-red-600 bg-card text-[13px] text-red-700 focus-visible:border-red-600";
const cellPickRed =
  "border-red-600 bg-red-50/60 hover:bg-red-50 data-[state=open]:bg-red-50";
const cellDateRed =
  "border-red-600 bg-card has-[[data-slot=input-group-control]:focus-visible]:border-red-600";
const cellHint = "block text-[10px] leading-tight font-normal text-muted-foreground";

/** Stable column set (module scope: a fresh array per render churns TanStack's sizing sync) */
const SHEET_COLUMNS: ColumnDef<unknown, unknown>[] = [
  { id: "date", header: "日期", size: 132, minSize: 118 },
  { id: "from", header: "起点", size: 138 },
  { id: "to", header: "终点", size: 138 },
  { id: "operation", header: "操作", size: 92 },
  { id: "load", header: "Load#", size: 108 },
  { id: "miles", header: "Miles", size: 86 },
  { id: "fuel", header: "加油(gal)", size: 86 },
  { id: "subsidy", header: "燃油补助", size: 86 },
  { id: "pay", header: "本趟工资", size: 108 },
  { id: "notes", header: "备注", size: 130 },
  { id: "actions", header: "操作", size: 76, enableResizing: false, meta: { headerClass: "px-1.5" } }
];
const NO_ROWS: unknown[] = [];

/** One leg's live numeric state, feeding day subtotals / week totals / strip */
type LegValues = { miles: number; fuel: number; pay: number; subsidy: number };

type CalcStatus = "loading" | "auto" | "failed";

/** Carrier-headed contiguous run of one package inside a day: the pay cell
 *  merges across the run (members skip their own cell, their hidden inputs
 *  move into the merged cell so dirty member rows still submit $0) */
type PaySpan = { span: number; members: DriverPeriodTripRow[] };

/**
 * Per day, annotate package carriers with the length of their contiguous
 * same-package stretch. Chained order keeps circuits together and the carrier
 * is the day's earliest-entered package leg, so it heads the stretch in the
 * common case; a stretch split by chaining degrades to today's per-cell rows.
 */
function planPaySpans(days: DayGroup[]) {
  const spans = new Map<string, PaySpan>();
  const folded = new Set<string>();
  for (const day of days) {
    day.legs.forEach((leg, i) => {
      if (!leg.package_id || !leg.package_note) return;
      let k = i + 1;
      while (k < day.legs.length && day.legs[k].package_id === leg.package_id) k++;
      spans.set(leg.id, { span: k - i, members: day.legs.slice(i + 1, k) });
      for (let j = i + 1; j < k; j++) folded.add(day.legs[j].id);
    });
  }
  return { spans, folded };
}

/**
 * One stored leg as a directly editable sheet row - same field set and
 * behavior as a home-sheet entry row: location pickers (creatable + map),
 * Google-measured miles on every endpoint change, rule-priced wage with a
 * sticky manual override. No edit button, no dialog: every cell is the
 * control. Saving goes through the surrounding form's updateTripsBatch.
 */
const EditableLegRow = React.memo(function EditableLegRow({
  leg,
  locations,
  operations,
  wageRule,
  returnTo,
  paySpan,
  payFolded,
  changedFields,
  added,
  onDirty,
  onValues
}: {
  leg: DriverPeriodTripRow;
  locations: LocationOption[];
  operations: OperationOption[];
  wageRule: WageRuleData | null;
  /** Full path the per-row delete redirects back to */
  returnTo: string;
  /** Carrier: how many rows its pay cell merges over + folded member legs */
  paySpan?: PaySpan;
  /** Member inside a merged run: renders no pay cell at all */
  payFolded?: boolean;
  /** Field keys that differ from the verification snapshot (red marks) */
  changedFields?: string[];
  /** Leg created after verification (whole-row tint + tag) */
  added?: boolean;
  onDirty: (id: string) => void;
  onValues: (id: string, values: LegValues) => void;
}) {
  const prefix = `leg_${leg.id}_`;
  const legLabel = `${leg.trip_date} 的第 ${leg.load_no || "—"} 程`;
  // Snapshot-diff marks: red class swaps per field (see cellInputRed note)
  const changed = new Set(changedFields ?? []);
  const redIf = (field: string, red: string, plain: string) =>
    changed.has(field) ? red : plain;

  // Stored endpoint -> picker value: the loc: pick when the row is in the
  // dictionary, else txt:<code>, else empty
  const endpointInitial = (locationId: string | null, code: string | null) => {
    if (locationId && locations.some(l => l.id === locationId)) return `loc:${locationId}`;
    return code ? `txt:${code}` : "";
  };

  const [dateValue, setDateValue] = React.useState(leg.trip_date);
  const [operation, setOperation] = React.useState(leg.operation);
  const operationRequiresLoad = (code: string) =>
    operations.find(o => o.code === code)?.requires_load ?? true;
  const [loadNoValue, setLoadNoValue] = React.useState(
    !operationRequiresLoad(leg.operation) ? "" : leg.load_no ?? ""
  );
  const [fromValue, setFromValue] = React.useState(() =>
    endpointInitial(leg.from_location_id, leg.from_code)
  );
  const [toValue, setToValue] = React.useState(() =>
    endpointInitial(leg.to_location_id, leg.to_code)
  );
  const [milesValue, setMilesValue] = React.useState(leg.miles || "0");
  const [fuelValue, setFuelValue] = React.useState(leg.fuel_gallons ?? "");
  const [status, setStatus] = React.useState<CalcStatus>("loading");
  const [manual, setManual] = React.useState(false);
  // Ignore stale responses after a quick endpoint re-pick
  const requestId = React.useRef(0);

  // Sticky manual wage: the stored amount opens as the manual value (it was
  // priced at entry time and must not silently drift on open); hand edits
  // keep it, only 重算 drops back to following the rule
  const [manualPay, setManualPay] = React.useState<string | null>(leg.pay_amount || null);

  // Google-measured miles: every endpoint (re-)pick re-measures, exactly like
  // an entry row; a failed measurement keeps the stored value for hand edits.
  // The mount-time measure does NOT mark the row dirty - only a user touch
  // does (the endpoint picks themselves report dirtiness).
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
            driverId: leg.driver_id,
            driverType: leg.driver_type,
            priceAsDriver: leg.price_as_driver,
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

  // Package legs: the carrier holds the whole amount (its note was set at
  // entry) and stays editable as an in-place correction - the strip that set
  // it is gone but the negotiated amount may need a fix; member legs bill $0
  // and stay read-only
  const packaged = Boolean(leg.package_id);
  const packageCarrier = packaged && Boolean(leg.package_note);
  const payValue = leg.pay_amount;

  // Owner fuel subsidy: derived from miles, read-only (the server re-snapshots
  // it on save at the then-current rate - never a submitted field)
  const subsidyRate = rule?.fuel_subsidy_rate ?? 0;
  const subsidyValue = calcFuelSubsidy({
    driverType: leg.driver_type,
    miles: Number(milesValue) || 0,
    rate: subsidyRate
  });

  // Report live numbers upward on every change (day subtotals + week totals)
  const milesNum = Number(milesValue) || 0;
  const fuelNum = Number(fuelValue) || 0;
  const payNum = packageCarrier
    ? Number(manualPay ?? payValue) || 0
    : packaged
      ? Number(payValue) || 0
      : Number(manualPay ?? autoPay.toFixed(2)) || 0;
  // Known deviation from derive-don't-effect: rows own their live numbers
  // behind a React.memo wall, so the parent's subtotals lift them through
  // this effect (a render-phase call would loop). Deps are primitives, so
  // each change still lands in one frame.
  React.useEffect(() => {
    onValues(leg.id, { miles: milesNum, fuel: fuelNum, pay: payNum, subsidy: subsidyValue });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milesNum, fuelNum, payNum, subsidyValue]);

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
    <tr className={added ? "bg-red-50/40" : undefined}>
      <td className="px-1.5">
        <DateField
          name={`${prefix}trip_date`}
          value={dateValue}
          onValueChange={value => {
            setDateValue(value);
            onDirty(leg.id);
          }}
          aria-label={`${legLabel}日期`}
          size="sm"
          groupClassName={redIf("trip_date", cellDateRed, cellDate)}
        />
        {added && <span className={`${cellHint} text-red-700`}>核对后新增</span>}
      </td>
      <td className="px-1.5">
        <LocationPicker
          name={`${prefix}from_location`}
          locations={locations}
          creatable
          value={fromValue}
          placeholder="起点"
          aria-label={`${legLabel}起点`}
          triggerClassName={`h-8 px-2 ${redIf("from", cellPickRed, cellPick)}`}
          onValueChange={value => {
            setFromValue(value);
            onDirty(leg.id);
          }}
        />
      </td>
      <td className="px-1.5">
        <LocationPicker
          name={`${prefix}to_location`}
          locations={locations}
          creatable
          value={toValue}
          placeholder="终点"
          aria-label={`${legLabel}终点`}
          triggerClassName={`h-8 px-2 ${redIf("to", cellPickRed, cellPick)}`}
          onValueChange={value => {
            setToValue(value);
            onDirty(leg.id);
          }}
        />
      </td>
      <td className="px-1.5">
        <ComboboxField
          name={`${prefix}operation`}
          value={operation}
          clearable={false}
          searchable={false}
          aria-label={`${legLabel}操作`}
          triggerClassName={`h-8 px-2 ${redIf("operation", cellPickRed, cellPick)}`}
          onValueChange={value => {
            setOperation(value);
            if (!operationRequiresLoad(value)) setLoadNoValue("");
            onDirty(leg.id);
          }}
          // Code-only labels keep the trigger narrow in the table row
          options={operations.map(op => ({ value: op.code, label: op.code }))}
        />
      </td>
      <td className="px-1.5">
        <Input
          name={`${prefix}load_no`}
          value={loadNoValue}
          onChange={e => {
            setLoadNoValue(e.target.value);
            onDirty(leg.id);
          }}
          disabled={!operationRequiresLoad(operation)}
          maxLength={64}
          placeholder={operationRequiresLoad(operation) ? "如 LD101" : "该操作免填"}
          aria-label={`${legLabel}Load#`}
          className={`${redIf("load_no", cellInputRed, cellInput)} font-mono font-semibold`}
        />
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}miles`}
          min={0}
          step="any"
          value={milesValue}
          onChange={e => {
            setMilesValue(e.target.value);
            setManual(true);
            onDirty(leg.id);
          }}
          aria-label={`${legLabel}里程`}
          className={`${redIf("miles", cellInputRed, cellInput)} font-mono`}
        />
        {milesHint && (
          <span className={`${cellHint} ${phase === "failed" ? "text-destructive" : ""}`}>
            {milesHint}
          </span>
        )}
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}fuel_gallons`}
          min={0}
          step={0.1}
          value={fuelValue}
          onChange={e => {
            setFuelValue(e.target.value);
            onDirty(leg.id);
          }}
          placeholder="—"
          aria-label={`${legLabel}加油量`}
          className={`${redIf("fuel_gallons", cellInputRed, cellInput)} font-mono`}
        />
      </td>
      <td className="px-1.5 font-mono text-[13px]">
        {leg.driver_type === "OWNER" && subsidyRate > 0
          ? money(subsidyValue.toFixed(2))
          : "—"}
      </td>
      {payFolded ? null : (
      <td className="px-1.5" rowSpan={paySpan?.span}>
        {packageCarrier ? (
          <>
            <Input
              type="number"
              name={`${prefix}pay_amount`}
              min={0}
              step={0.01}
              value={manualPay ?? ""}
              onChange={e => {
                setManualPay(e.target.value);
                onDirty(leg.id);
              }}
              aria-label={`${legLabel}工资`}
              className={`${redIf("pay_amount", cellInputRed, cellInput)} font-mono`}
            />
            <span className={cellHint}>
              {leg.package_note} · 整包金额{paySpan && paySpan.span > 1 ? `（${paySpan.span} 程）` : ""}
            </span>
            {/* Folded members submit their stored $0 from the merged cell */}
            {paySpan?.members.map(m => (
              <input key={m.id} type="hidden" name={`leg_${m.id}_pay_amount`} value={m.pay_amount} />
            ))}
          </>
        ) : packaged ? (
          <>
            <input type="hidden" name={`${prefix}pay_amount`} value={payValue} />
            <span
              className={`block px-2 font-mono text-[13px] tabular-nums ${
                changed.has("pay_amount") ? "text-red-700" : ""
              }`}
            >
              {money(payValue)}
            </span>
            <span className={cellHint}>
              {leg.package_note ?? "打包内 · $0"}
            </span>
          </>
        ) : (
          <>
            <Input
              type="number"
              name={`${prefix}pay_amount`}
              min={0}
              step={0.01}
              value={manualPay ?? autoPay.toFixed(2)}
              onChange={e => {
                setManualPay(e.target.value);
                onDirty(leg.id);
              }}
              aria-label={`${legLabel}工资`}
              className={`${redIf("pay_amount", cellInputRed, cellInput)} font-mono`}
            />
            {manualPay !== null && (
              <span className={cellHint}>
                手动 ·{" "}
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    setManualPay(null);
                    onDirty(leg.id);
                  }}
                >
                  重算
                </button>
              </span>
            )}
          </>
        )}
      </td>
      )}
      <td className="px-1.5">
        <Input
          name={`${prefix}notes`}
          defaultValue={leg.notes ?? ""}
          placeholder="选填"
          aria-label={`${legLabel}备注`}
          className={redIf("notes", cellInputRed, cellInput)}
          onChange={() => onDirty(leg.id)}
        />
      </td>
      <td className="actions px-1.5">
        <DeleteLegButton legId={leg.id} returnTo={returnTo} />
      </td>
    </tr>
  );
});

/** Pricing identity of the sheet's driver, for rows that don't exist yet */
export type NewLegContext = {
  driverId: string;
  driverType: "DRIVER" | "OWNER";
  priceAsDriver: boolean;
  /** Date a fresh row opens with (business today inside the period) */
  defaultDate: string;
};

/**
 * One not-yet-saved leg appended to the sheet: the same cells and behavior
 * as EditableLegRow (location pickers, Google-measured miles, rule-priced
 * wage with a sticky manual override) minus everything a stored row carries
 * (package spans, snapshot marks, server delete). Field names are positional
 * under leg_new_<i>_ so the batch save can INSERT them alongside the UPDATEs.
 */
const NewLegRow = React.memo(function NewLegRow({
  slotId,
  rowIndex,
  ctx,
  locations,
  operations,
  wageRule,
  onRemove,
  onTouched
}: {
  /** Stable slot id (React key); travels with the row's state across removals */
  slotId: number;
  rowIndex: number;
  ctx: NewLegContext;
  locations: LocationOption[];
  operations: OperationOption[];
  wageRule: WageRuleData | null;
  onRemove: (slotId: number) => void;
  /** Any edit reports the row as carried (gates the save button) */
  onTouched: (slotId: number) => void;
}) {
  const prefix = `leg_new_${rowIndex}_`;
  const legLabel = `新行程第 ${rowIndex + 1} 行`;

  const [dateValue, setDateValue] = React.useState(ctx.defaultDate);
  const [operation, setOperation] = React.useState(operations[0]?.code ?? "");
  const operationRequiresLoad = (code: string) =>
    operations.find(o => o.code === code)?.requires_load ?? true;
  const [loadNoValue, setLoadNoValue] = React.useState("");
  const [fromValue, setFromValue] = React.useState("");
  const [toValue, setToValue] = React.useState("");
  const [milesValue, setMilesValue] = React.useState("0");
  const [fuelValue, setFuelValue] = React.useState("");
  const [status, setStatus] = React.useState<CalcStatus>("loading");
  const [manual, setManual] = React.useState(false);
  const requestId = React.useRef(0);
  // Auto-priced until hand-edited; the sticky-manual contract of EditableLegRow
  const [manualPay, setManualPay] = React.useState<string | null>(null);

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

  const wageEndpoint = (value: string) =>
    locations.find(l => `loc:${l.id}` === value) ?? null;

  const rule = wageRule;
  const autoPay = React.useMemo(
    () =>
      rule
        ? calcTripWage({
            driverId: ctx.driverId,
            driverType: ctx.driverType,
            priceAsDriver: ctx.priceAsDriver,
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

  const subsidyRate = rule?.fuel_subsidy_rate ?? 0;
  const subsidyValue = calcFuelSubsidy({
    driverType: ctx.driverType,
    miles: Number(milesValue) || 0,
    rate: subsidyRate
  });

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
    <tr>
      <td className="px-1.5">
        <DateField
          name={`${prefix}trip_date`}
          value={dateValue}
          onValueChange={value => {
            setDateValue(value);
            onTouched(slotId);
          }}
          aria-label={`${legLabel}日期`}
          size="sm"
          groupClassName={cellDate}
        />
      </td>
      <td className="px-1.5">
        <LocationPicker
          name={`${prefix}from_location`}
          locations={locations}
          creatable
          value={fromValue}
          placeholder="起点"
          aria-label={`${legLabel}起点`}
          triggerClassName={`h-8 px-2 ${cellPick}`}
          onValueChange={value => {
            setFromValue(value);
            onTouched(slotId);
          }}
        />
      </td>
      <td className="px-1.5">
        <LocationPicker
          name={`${prefix}to_location`}
          locations={locations}
          creatable
          value={toValue}
          placeholder="终点"
          aria-label={`${legLabel}终点`}
          triggerClassName={`h-8 px-2 ${cellPick}`}
          onValueChange={value => {
            setToValue(value);
            onTouched(slotId);
          }}
        />
      </td>
      <td className="px-1.5">
        <ComboboxField
          name={`${prefix}operation`}
          value={operation}
          clearable={false}
          searchable={false}
          aria-label={`${legLabel}操作`}
          triggerClassName={`h-8 px-2 ${cellPick}`}
          onValueChange={value => {
            setOperation(value);
            if (!operationRequiresLoad(value)) setLoadNoValue("");
            onTouched(slotId);
          }}
          options={operations.map(op => ({ value: op.code, label: op.code }))}
        />
      </td>
      <td className="px-1.5">
        <Input
          name={`${prefix}load_no`}
          value={loadNoValue}
          onChange={e => {
            setLoadNoValue(e.target.value);
            onTouched(slotId);
          }}
          disabled={!operationRequiresLoad(operation)}
          maxLength={64}
          placeholder={operationRequiresLoad(operation) ? "如 LD101" : "该操作免填"}
          aria-label={`${legLabel}Load#`}
          className={`${cellInput} font-mono font-semibold`}
        />
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}miles`}
          min={0}
          step="any"
          value={milesValue}
          onChange={e => {
            setMilesValue(e.target.value);
            setManual(true);
            onTouched(slotId);
          }}
          aria-label={`${legLabel}里程`}
          className={`${cellInput} font-mono`}
        />
        {milesHint && (
          <span className={`${cellHint} ${phase === "failed" ? "text-destructive" : ""}`}>
            {milesHint}
          </span>
        )}
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}fuel_gallons`}
          min={0}
          step={0.1}
          value={fuelValue}
          onChange={e => {
            setFuelValue(e.target.value);
            onTouched(slotId);
          }}
          placeholder="—"
          aria-label={`${legLabel}加油量`}
          className={`${cellInput} font-mono`}
        />
      </td>
      <td className="px-1.5 font-mono text-[13px]">
        {ctx.driverType === "OWNER" && subsidyRate > 0
          ? money(subsidyValue.toFixed(2))
          : "—"}
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}pay_amount`}
          min={0}
          step={0.01}
          value={manualPay ?? autoPay.toFixed(2)}
          onChange={e => {
            setManualPay(e.target.value);
            onTouched(slotId);
          }}
          aria-label={`${legLabel}工资`}
          className={`${cellInput} font-mono`}
        />
        {manualPay !== null && (
          <span className={cellHint}>
            手动 ·{" "}
            <button
              type="button"
              className="linklike"
              onClick={() => {
                setManualPay(null);
                onTouched(slotId);
              }}
            >
              重算
            </button>
          </span>
        )}
      </td>
      <td className="px-1.5">
        <Input
          name={`${prefix}notes`}
          defaultValue=""
          placeholder="选填"
          aria-label={`${legLabel}备注`}
          className={cellInput}
          onChange={() => onTouched(slotId)}
        />
      </td>
      <td className="actions px-1.5">
        <button
          type="button"
          className="linklike danger"
          onClick={() => onRemove(slotId)}
        >
          删除
        </button>
      </td>
    </tr>
  );
});

/** Per-leg delete: calls the server action directly - a nested <form> inside
 *  the save form would be invalid HTML */
function DeleteLegButton({ legId, returnTo }: { legId: string; returnTo: string }) {
  return (
    <ConfirmAction
      danger
      title="删除这条行程？"
      description="删除后该行程将从台账与工资单中移除，不可恢复。"
      confirmLabel="删除"
      pendingLabel="删除中…"
      trigger={props => (
        <button {...props} className="linklike danger">
          删除
        </button>
      )}
      onConfirm={async () => {
        const fd = new FormData();
        fd.set("id", legId);
        fd.set("return_to", returnTo);
        try {
          await deleteTrip(fd);
          toast.success("行程已删除");
        } catch (error) {
          // The action's redirect rejects with NEXT_REDIRECT on success
          if (isRedirectError(error)) toast.success("行程已删除");
          else toast.error("删除失败，请重试");
        }
      }}
    />
  );
}

/**
 * Drill-down ledger for one driver's period - directly editable like the
 * entry sheet: click a cell and change it, then one 保存修改 writes every
 * dirty row (updateTripsBatch, statements follow automatically). Uses the
 * shared shell's hand-rendered tbody mode: day subtotal rows (matrix-sub) and
 * the week total (matrix-total) interleave with data rows via colSpan.
 */
export function PayrollLegsTable({
  days,
  returnTo,
  edit,
  /** Pricing identity + opening date for appended rows */
  newLegCtx,
  storageKey = "payops.payroll.legs.cols",
  /** Verification-snapshot diff: field keys per changed leg + post-verify
   *  additions (undefined on legacy statements without a snapshot) */
  changes
}: {
  days: DayGroup[];
  /** Where the per-row delete redirects back to (full path with ?period=) */
  returnTo: string;
  edit: TripEditDictionaries;
  newLegCtx: NewLegContext;
  storageKey?: string;
  changes?: { changedFieldsByLeg: Record<string, string[]>; addedLegIds: string[] };
}) {
  // Live per-leg numbers (initial = stored), recomputed subtotals read these
  const [live, setLive] = React.useState<Record<string, LegValues>>(() =>
    Object.fromEntries(
      days.flatMap(d =>
        d.legs.map(l => [
          l.id,
          {
            miles: Number(l.miles) || 0,
            fuel: Number(l.fuel_gallons) || 0,
            pay: Number(l.pay_amount) || 0,
            subsidy: Number(l.fuel_subsidy) || 0
          }
        ])
      )
    )
  );
  const [dirty, setDirty] = React.useState<Set<string>>(new Set());
  // Appended (not-yet-saved) rows: stable slot ids only - each NewLegRow owns
  // its values; touched ids gate the save button (the server skips empties)
  const [newSlots, setNewSlots] = React.useState<number[]>([]);
  const [newTouched, setNewTouched] = React.useState<Set<number>>(new Set());
  const nextNewSlotId = React.useRef(1);

  // Package pay cells merge across each carrier's contiguous run (stable
  // across renders: EditableLegRow is memo'd on these props)
  const { spans, folded } = React.useMemo(() => planPaySpans(days), [days]);
  // Post-verify additions as a lookup (diff data arrives from the server)
  const addedLegIds = React.useMemo(
    () => new Set(changes?.addedLegIds ?? []),
    [changes]
  );

  const onDirty = React.useCallback((id: string) => {
    setDirty(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const onValues = React.useCallback((id: string, values: LegValues) => {
    setLive(prev => ({ ...prev, [id]: values }));
  }, []);
  const removeNewRow = React.useCallback((slotId: number) => {
    setNewSlots(prev => prev.filter(id => id !== slotId));
    setNewTouched(prev => {
      if (!prev.has(slotId)) return prev;
      const next = new Set(prev);
      next.delete(slotId);
      return next;
    });
  }, []);
  const touchNewRow = React.useCallback((slotId: number) => {
    setNewTouched(prev => (prev.has(slotId) ? prev : new Set(prev).add(slotId)));
  }, []);
  function addNewRow() {
    const id = nextNewSlotId.current++;
    setNewSlots(prev => [...prev, id]);
  }

  const valuesOf = (id: string): LegValues =>
    live[id] ?? { miles: 0, fuel: 0, pay: 0, subsidy: 0 };

  // Day subtotals live off the current inputs (what you see is what saves)
  const dayTotals = (day: DayGroup) =>
    day.legs.reduce(
      (acc, l) => {
        const v = valuesOf(l.id);
        return {
          miles: acc.miles + v.miles,
          fuel: acc.fuel + v.fuel,
          pay: acc.pay + v.pay,
          subsidy: acc.subsidy + (l.driver_type === "OWNER" ? v.subsidy : 0)
        };
      },
      { miles: 0, fuel: 0, pay: 0, subsidy: 0 }
    );
  const week = days.reduce(
    (acc, d) => {
      const t = dayTotals(d);
      return {
        miles: acc.miles + t.miles,
        fuel: acc.fuel + t.fuel,
        pay: acc.pay + t.pay,
        subsidy: acc.subsidy + t.subsidy
      };
    },
    { miles: 0, fuel: 0, pay: 0, subsidy: 0 }
  );

  const table = useRosterTable({ data: NO_ROWS, columns: SHEET_COLUMNS, storageKey });
  const dirtyCount = dirty.size;
  const newCount = newTouched.size;

  // Lift the counts to the enclosing sheet form's save bar (same documented
  // deviation as onValues: counts live behind this component's state wall)
  const sheet = useSheetReport();
  React.useEffect(() => {
    sheet?.reportLegs(dirtyCount, newCount);
  }, [dirtyCount, newCount, sheet]);

  return (
    <div>
      <input type="hidden" name="dirty_ids" value={[...dirty].join(",")} />
      <input type="hidden" name="new_row_count" value={newSlots.length} />
      <RosterTable table={table}>
        <tbody>
          {days.length === 0 && (
            <tr>
              <td colSpan={SHEET_COLUMNS.length} className="empty">
                本周期没有行程记录。
              </td>
            </tr>
          )}
          {days.flatMap(day => [
            ...day.legs.map(leg => (
              <EditableLegRow
                key={leg.id}
                leg={leg}
                locations={edit.locations}
                operations={edit.operations}
                wageRule={edit.wageRule}
                returnTo={returnTo}
                paySpan={spans.get(leg.id)}
                payFolded={folded.has(leg.id)}
                changedFields={changes?.changedFieldsByLeg[leg.id]}
                added={addedLegIds.has(leg.id)}
                onDirty={onDirty}
                onValues={onValues}
              />
            )),
            (() => {
              const t = dayTotals(day);
              return (
                <tr key={`sub-${day.date}`} className="matrix-sub">
                  <td colSpan={5}>
                    小计 · {day.date.slice(5).replace("-", "/")} 周{dowOf(day.date)}
                  </td>
                  <td>{fmtMiles(t.miles.toString())}</td>
                  <td>{fmtFuel(t.fuel.toString())}</td>
                  <td>{t.subsidy > 0 ? money(t.subsidy.toString()) : "—"}</td>
                  <td>{money(t.pay.toString())}</td>
                  <td colSpan={2} />
                </tr>
              );
            })()
          ])}
          {days.length > 1 && (
            <tr className="matrix-total">
              <td colSpan={5}>周合计 · {days.length} 天</td>
              <td>{fmtMiles(week.miles.toString())}</td>
              <td>{fmtFuel(week.fuel.toString())}</td>
              <td>{week.subsidy > 0 ? money(week.subsidy.toString()) : "—"}</td>
              <td>{money(week.pay.toString())}</td>
              <td colSpan={2} />
            </tr>
          )}
          {newSlots.length > 0 && (
            <>
              {/* Appended rows sit below the week total: their date may belong
                  to any day, so they join the day blocks only after saving */}
              <tr className="matrix-sub">
                <td colSpan={SHEET_COLUMNS.length}>
                  新增行程 · {newSlots.length} 行 · 保存后并入对应日期
                </td>
              </tr>
              {newSlots.map((slotId, i) => (
                <NewLegRow
                  key={slotId}
                  slotId={slotId}
                  rowIndex={i}
                  ctx={newLegCtx}
                  locations={edit.locations}
                  operations={edit.operations}
                  wageRule={edit.wageRule}
                  onRemove={removeNewRow}
                  onTouched={touchNewRow}
                />
              ))}
            </>
          )}
        </tbody>
      </RosterTable>
      {/* Add-row bar mirrors the entry sheet: finishing the last row, the
          clerk continues right there */}
      <button type="button" className="add-row-bar" onClick={addNewRow}>
        <PlusIcon className="size-3.5" />
        添加行程
      </button>
    </div>
  );
}
