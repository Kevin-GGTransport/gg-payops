"use client";

import * as React from "react";
import { CameraIcon, GripVerticalIcon, PlusIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ComboboxField } from "@/components/combobox-field";
import { LocationPicker, type LocationOption } from "@/components/location-picker";
import { calcTripWage } from "@/lib/wage";
import { money, todayIso } from "@/lib/format";
import {
  DRIVER_TYPE_LABELS,
  OPERATION_META,
  type DriverType,
  type OperationType
} from "@/lib/labels";
import { addTripsBatch } from "./entry-actions";
import { PhotoImport, type PhotoApply } from "./photo-import";

type DriverOption = {
  id: string;
  driver_code: string;
  full_name: string;
  driver_type: DriverType;
};

/** One row's initial values (photo import or failed-submit refill) */
export type RefillRow = {
  trip_date?: string;
  operation: string;
  from: string;
  to: string;
  load_no: string;
  miles: string;
  pay_amount: string;
  notes: string;
};

/** One group's initial shape: one driver + a default date + its own rows */
export type RefillGroup = {
  driverId: string;
  date: string;
  rows: RefillRow[];
};

type TripEntryFormProps = {
  drivers: DriverOption[];
  locations: LocationOption[];
  defaultDriverId?: string;
  defaultDate?: string;
  /** Present when redirected back after a validation error */
  refillGroups?: RefillGroup[];
};

const INITIAL_ROWS = 3;

/** Bare input for table cells: no label, no border, inherits the roster rhythm */
const cellInput = "h-8 border-0 bg-transparent px-2 shadow-none rounded-none text-[13px] focus-visible:ring-1";
const cellHint = "block text-[10px] leading-tight font-normal text-muted-foreground";

type ColumnDef = { key: string; label: string; width: number; min: number; num?: boolean };

/**
 * Resizable column layout shared by every group table (the trailing actions
 * column is fixed and not listed). Defaults stay under ~1000px so common
 * laptop widths fit without horizontal scrolling; drag handles adjust per
 * user and persist to localStorage.
 */
const COLUMNS: ColumnDef[] = [
  { key: "trip_date", label: "日期", width: 100, min: 84 },
  { key: "from_location", label: "起点", width: 130, min: 100 },
  { key: "to_location", label: "终点", width: 130, min: 100 },
  { key: "operation", label: "操作", width: 72, min: 64 },
  { key: "load_no", label: "Load#", width: 90, min: 76 },
  { key: "miles", label: "里程 (mi)", width: 82, min: 72, num: true },
  { key: "pay_amount", label: "本趟工资 ($)", width: 100, min: 92, num: true },
  { key: "notes", label: "备注", width: 182, min: 100 }
];

/** Width of the leading drag-handle column (fixed, not resizable) */
const HANDLE_COL_W = 28;
/** Width of the trailing delete-actions column (fixed, not resizable) */
const ACTIONS_COL_W = 40;
const COL_WIDTHS_KEY = "payops.entry.colwidths";

function defaultColWidths() {
  return COLUMNS.map(c => c.width);
}

function loadColWidths(): number[] {
  if (typeof window === "undefined") return defaultColWidths();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COL_WIDTHS_KEY) ?? "");
    if (
      Array.isArray(parsed) &&
      parsed.length === COLUMNS.length &&
      parsed.every(n => typeof n === "number" && n > 0)
    ) {
      // Re-clamp in case the stored value predates a min-width bump
      return parsed.map((n: number, i) => Math.max(n, COLUMNS[i].min));
    }
  } catch {
    // Missing / corrupted value -> defaults
  }
  return defaultColWidths();
}

type CalcStatus = "loading" | "auto" | "failed";

/**
 * One entry row: per-row date, from/to pickers (creatable), operation, Load#,
 * auto-measured miles and rule-priced wage (both hand-editable; the wage
 * sticks once edited, miles re-measures on every endpoint re-pick). Field
 * names are positional (g_<group>_row_<index>_) so deleting a middle row only
 * shifts names, never values.
 */
function EntryRow({
  groupIndex,
  rowIndex,
  defaultDate,
  driverType,
  locations,
  defaults,
  removable,
  carryFrom,
  onRemove,
  onPayChange,
  onToChange,
  onArmDrag,
  onRowDragStart,
  onRowDragEnd,
  onRowDragOver,
  onRowDrop,
  draggable,
  dropMark
}: {
  groupIndex: number;
  rowIndex: number;
  defaultDate: string;
  driverType: DriverType | undefined;
  locations: LocationOption[];
  defaults?: RefillRow;
  removable: boolean;
  /** Current to-value of the previous leg in this group ("" when none yet) */
  carryFrom: string;
  onRemove: () => void;
  onPayChange: (value: string) => void;
  /** Reports every endpoint pick upward (feeds the next leg's carry) */
  onToChange: (value: string) => void;
  /** Grip press arms / releases whole-row native drag */
  onArmDrag: (armed: boolean) => void;
  onRowDragStart: (event: React.DragEvent<HTMLTableRowElement>) => void;
  onRowDragEnd: () => void;
  onRowDragOver: (event: React.DragEvent<HTMLTableRowElement>) => void;
  onRowDrop: (event: React.DragEvent<HTMLTableRowElement>) => void;
  /** This row is the armed drag source */
  draggable: boolean;
  /** Insertion indicator while a sibling row hovers this one */
  dropMark: "before" | "after" | null;
}) {
  const prefix = `g_${groupIndex}_row_${rowIndex}_`;
  const legLabel = `第 ${groupIndex + 1} 组第 ${rowIndex + 1} 程`;
  const [operation, setOperation] = React.useState(defaults?.operation || "DEL");
  const [fromValue, setFromValue] = React.useState(defaults?.from || "");
  const [toValue, setToValue] = React.useState(defaults?.to || "");
  // Whether the current from value came from carry-over, not the user's own
  // pick (refill/photo defaults count as manual - carry never overwrites them)
  const fromInherited = React.useRef(false);
  const [milesValue, setMilesValue] = React.useState(defaults?.miles || "0");
  const [status, setStatus] = React.useState<CalcStatus>("loading");
  const [manual, setManual] = React.useState(false);
  // Ignore stale responses after a quick endpoint re-pick
  const requestId = React.useRef(0);

  // Sticky manual wage: null = auto-follow the rule; once set (hand edit or
  // error restore) basis changes never overwrite it - only "按规则重算" drops back
  const [manualPay, setManualPay] = React.useState<string | null>(defaults?.pay_amount || null);

  // Carry-over start (sticky follow): the previous leg's endpoint fills this
  // leg's start while it is empty or still carry-inherited - a hand-picked
  // start sticks forever, an empty carry never clears what's already there
  React.useEffect(() => {
    if (!carryFrom) return;
    if (fromInherited.current || fromValue === "") {
      fromInherited.current = true;
      setFromValue(carryFrom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carryFrom]);

  // Report the initial (refill/photo) endpoint once so the next leg can carry it
  React.useEffect(() => {
    if (toValue) onToChange(toValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Free-text endpoints never carry BASE pricing -> mileage tier, same as a
  // picked non-BASE location, so they resolve to null endpoints here
  const wageEndpoint = (value: string) =>
    locations.find(l => `loc:${l.id}` === value) ?? null;

  const autoPay = React.useMemo(
    () =>
      calcTripWage({
        driverType,
        operation: operation as OperationType | undefined,
        miles: Number(milesValue) || 0,
        from: wageEndpoint(fromValue),
        to: wageEndpoint(toValue)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driverType, operation, milesValue, fromValue, toValue, locations]
  );

  const payValue = manualPay ?? autoPay.toFixed(2);

  React.useEffect(() => {
    onPayChange(payValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payValue]);

  const phase = !fromValue || !toValue ? "idle" : status;
  const milesHint =
    phase === "loading"
      ? "测算中…"
      : manual
        ? "手动输入"
        : phase === "failed"
          ? "未能测算，请手填"
          : phase === "auto"
            ? "已测算，可修改"
            : "选两端后自动测算";

  return (
    <tr
      draggable={draggable}
      onDragStart={onRowDragStart}
      onDragEnd={onRowDragEnd}
      onDragOver={onRowDragOver}
      onDrop={onRowDrop}
      className={`${draggable ? "row-dragging" : ""}${dropMark ? ` drop-${dropMark}` : ""}`}
    >
      <td className="px-1 text-center">
        <span
          className="drag-handle"
          aria-label={`拖拽调整${legLabel}顺序`}
          onPointerDown={() => onArmDrag(true)}
          onPointerUp={() => onArmDrag(false)}
          onPointerCancel={() => onArmDrag(false)}
        >
          <GripVerticalIcon className="size-3.5" />
        </span>
      </td>
      <td className="px-1.5">
        <Input
          type="date"
          name={`${prefix}trip_date`}
          defaultValue={defaults?.trip_date || defaultDate}
          aria-label={`${legLabel}日期`}
          className={`${cellInput} font-mono`}
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
          triggerClassName="h-8 justify-start px-2 font-normal"
          onValueChange={value => {
            fromInherited.current = false;
            setFromValue(value);
          }}
        />
      </td>
      <td className="px-1.5">
        <LocationPicker
          name={`${prefix}to_location`}
          locations={locations}
          creatable
          defaultValue={defaults?.to || ""}
          placeholder="终点"
          aria-label={`${legLabel}终点`}
          triggerClassName="h-8 justify-start px-2 font-normal"
          onValueChange={value => {
            setToValue(value);
            onToChange(value);
          }}
        />
      </td>
      <td className="px-1.5">
        <ComboboxField
          name={`${prefix}operation`}
          defaultValue={defaults?.operation || "DEL"}
          clearable={false}
          searchable={false}
          aria-label={`${legLabel}操作`}
          triggerClassName="h-8 justify-start px-2 font-normal"
          onValueChange={setOperation}
          // Code-only labels keep the trigger narrow in the table row
          options={(Object.keys(OPERATION_META) as OperationType[]).map(key => ({
            value: key,
            label: key
          }))}
        />
      </td>
      <td className="px-1.5">
        <Input
          name={`${prefix}load_no`}
          defaultValue={defaults?.load_no || ""}
          maxLength={64}
          placeholder="如 LD101"
          aria-label={`${legLabel}Load#`}
          className={`${cellInput} font-mono font-semibold`}
        />
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}miles`}
          min={0}
          step={0.1}
          value={milesValue}
          onChange={e => {
            setMilesValue(e.target.value);
            setManual(true);
          }}
          aria-label={`${legLabel}里程`}
          className={`${cellInput} text-right font-mono`}
        />
        <span className={`${cellHint} text-right ${phase === "failed" ? "text-destructive" : ""}`}>{milesHint}</span>
      </td>
      <td className="px-1.5">
        <Input
          type="number"
          name={`${prefix}pay_amount`}
          min={0}
          step={0.01}
          value={payValue}
          onChange={e => setManualPay(e.target.value)}
          aria-label={`${legLabel}工资`}
          className={`${cellInput} text-right font-mono`}
        />
        <span className={`${cellHint} text-right`}>
          {manualPay !== null ? (
            <>
              手动 ·{" "}
              <button type="button" className="linklike" onClick={() => setManualPay(null)}>
                重算
              </button>
            </>
          ) : (
            "按规则计算"
          )}
        </span>
      </td>
      <td className="px-1.5">
        <Input
          name={`${prefix}notes`}
          defaultValue={defaults?.notes || ""}
          placeholder="选填"
          aria-label={`${legLabel}备注`}
          className={cellInput}
        />
      </td>
      <td className="actions px-1.5">
        {removable && (
          <button type="button" className="linklike danger" onClick={onRemove}>
            删除
          </button>
        )}
      </td>
    </tr>
  );
}

/** A row slot: stable id (React key, never reused) plus its one-shot defaults */
type RowSlot = { id: number; defaults?: RefillRow };

/** A group slot: stable id + one-shot initial driver/date/rows */
type GroupSlot = { id: number; driverId: string; date: string; rows: RowSlot[] };

/**
 * One driver group rendered as a tbody of the shared sheet: a full-width
 * driver band row (driver picker, default date, add/remove actions) followed
 * by the group's trip rows. Row/driver/date state lives here once mounted;
 * the parent only tracks group existence, row counts and pay totals.
 */
function GroupSection({
  index,
  group,
  drivers,
  locations,
  removable,
  onRemove,
  onPayChange,
  onForgetRow,
  onRowsChange,
  onDirty,
  dragging,
  onDraggingChange,
  paySum
}: {
  index: number;
  group: GroupSlot;
  drivers: DriverOption[];
  locations: LocationOption[];
  removable: boolean;
  onRemove: () => void;
  onPayChange: (rowId: number, value: string) => void;
  onForgetRow: (rowId: number) => void;
  onRowsChange: (count: number) => void;
  onDirty: () => void;
  /** Live drag source shared across groups (a group only accepts its own) */
  dragging: { groupId: number; rowId: number } | null;
  onDraggingChange: (source: { groupId: number; rowId: number } | null) => void;
  paySum: number;
}) {
  const [driverId, setDriverId] = React.useState(group.driverId);
  const [date, setDate] = React.useState(group.date);
  const [rows, setRows] = React.useState<RowSlot[]>(group.rows);
  const [nextRowId, setNextRowId] = React.useState(
    group.rows.reduce((max, r) => Math.max(max, r.id), 0) + 1
  );
  // rowId -> current to-value, feeding the next leg's carry-over start
  const [toByRow, setToByRow] = React.useState<Record<number, string>>({});
  // Grip pressed but drag not confirmed yet; only that row turns draggable
  const [armedRow, setArmedRow] = React.useState<number | null>(null);
  // Insertion point while a same-group drag hovers this sheet
  const [dropAt, setDropAt] = React.useState<{ id: number; before: boolean } | null>(null);
  const dragActive = dragging?.groupId === group.id;
  const driverType = drivers.find(d => d.id === driverId)?.driver_type;

  React.useEffect(() => {
    onRowsChange(rows.length);
  }, [rows.length, onRowsChange]);

  function addRow() {
    onDirty();
    setRows(current => [...current, { id: nextRowId }]);
    setNextRowId(id => id + 1);
  }

  function removeRow(slot: RowSlot) {
    onDirty();
    onForgetRow(slot.id);
    setRows(current => current.filter(r => r.id !== slot.id));
    setToByRow(current => {
      if (!(slot.id in current)) return current;
      const next = { ...current };
      delete next[slot.id];
      return next;
    });
  }

  /** Reorder rows inside this group; stable slot ids travel with their values */
  function moveRow(fromId: number, toId: number, before: boolean) {
    const from = rows.findIndex(r => r.id === fromId);
    const to = rows.findIndex(r => r.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    const insertAt = next.findIndex(r => r.id === toId) + (before ? 0 : 1);
    next.splice(insertAt, 0, moved);
    onDirty();
    setRows(next);
  }

  function endDrag() {
    setArmedRow(null);
    setDropAt(null);
    onDraggingChange(null);
  }

  function handleToChange(rowId: number, value: string) {
    setToByRow(current =>
      current[rowId] === value ? current : { ...current, [rowId]: value }
    );
  }

  const prefix = `g_${index}`;

  return (
    <tbody
      className="tb-group"
      onDragLeave={event => {
        // Drag left this sheet entirely (moving between our own rows doesn't)
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropAt(null);
        }
      }}
    >
      {/* Driver separator band: opens one group inside the single sheet */}
      <tr className="row-band">
        <td colSpan={COLUMNS.length + 2}>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5 px-2.5">
            <span className="mb-0.5 rounded-[3px] border border-line bg-card px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
              组 {index + 1}
            </span>
            <ComboboxField
              label="司机 / 车主"
              name={`${prefix}_driver_id`}
              defaultValue={group.driverId}
              placeholder="请选择司机"
              searchPlaceholder="搜索车号或姓名"
              mono
              prominent
              clearable={false}
              className="w-56"
              triggerClassName="h-10"
              onValueChange={setDriverId}
              options={drivers.map(d => ({
                value: d.id,
                label: d.driver_code,
                description: `${d.full_name}（${DRIVER_TYPE_LABELS[d.driver_type]}）`,
                group: DRIVER_TYPE_LABELS[d.driver_type]
              }))}
            />
            <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              日期（新行默认）
              <Input
                type="date"
                name={`${prefix}_trip_date`}
                defaultValue={group.date}
                onChange={e => setDate(e.target.value)}
                aria-label={`第 ${index + 1} 组新行默认日期`}
                className="h-8 w-36 font-mono text-[13px]"
              />
            </label>
            <div className="ml-auto flex items-center gap-3 pb-1.5 text-xs text-muted-foreground">
              <span>
                本组 {rows.length} 段 ·{" "}
                <b className="font-mono text-foreground">{money(paySum)}</b>
              </span>
              <button type="button" className="linklike" onClick={addRow}>
                <PlusIcon className="mr-0.5 inline size-3.5" />
                添加行程
              </button>
              {removable && (
                <button type="button" className="linklike danger" onClick={onRemove}>
                  删除组
                </button>
              )}
            </div>
          </div>
          <input type="hidden" name={`${prefix}_row_count`} value={rows.length} />
        </td>
      </tr>
      {rows.map((slot, i) => (
        <EntryRow
          key={slot.id}
          groupIndex={index}
          rowIndex={i}
          defaultDate={date}
          driverType={driverType}
          locations={locations}
          defaults={slot.defaults}
          removable={rows.length > 1}
          carryFrom={i === 0 ? "" : (toByRow[rows[i - 1].id] ?? "")}
          onRemove={() => removeRow(slot)}
          onPayChange={value => onPayChange(slot.id, value)}
          onToChange={value => handleToChange(slot.id, value)}
          draggable={armedRow === slot.id}
          dropMark={dropAt?.id === slot.id ? (dropAt.before ? "before" : "after") : null}
          onArmDrag={armed => setArmedRow(armed ? slot.id : null)}
          onRowDragStart={event => {
            event.dataTransfer.effectAllowed = "move";
            // Firefox only fires dragover when the drag carries some payload
            event.dataTransfer.setData("text/plain", String(slot.id));
            onDraggingChange({ groupId: group.id, rowId: slot.id });
          }}
          onRowDragEnd={endDrag}
          onRowDragOver={event => {
            // Same-group reorder only: a foreign group's drag keeps the no-drop cursor
            if (!dragActive) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const rect = event.currentTarget.getBoundingClientRect();
            const before = event.clientY < rect.top + rect.height / 2;
            setDropAt(current =>
              current?.id === slot.id && current.before === before
                ? current
                : { id: slot.id, before }
            );
          }}
          onRowDrop={event => {
            event.preventDefault();
            if (dragging && dropAt) moveRow(dragging.rowId, dropAt.id, dropAt.before);
            endDrag();
          }}
        />
      ))}
    </tbody>
  );
}

/**
 * Full trip-entry form: driver groups stacked in one panel, each with its own
 * spreadsheet table whose rows carry their own dates (a recognized sheet is
 * one driver, many days). Submits everything to addTripsBatch in one atomic
 * multi-row INSERT.
 */
export function TripEntryForm({
  drivers,
  locations,
  defaultDriverId = "",
  defaultDate,
  refillGroups
}: TripEntryFormProps) {
  const [photoOpen, setPhotoOpen] = React.useState(false);
  const [colWidths, setColWidths] = React.useState<number[]>(loadColWidths);
  const initialGroups: GroupSlot[] = refillGroups
    ? refillGroups.map((g, i) => ({
        id: i + 1,
        driverId: g.driverId,
        date: g.date || todayIso(),
        rows: g.rows.map((row, j) => ({ id: j + 1, defaults: row }))
      }))
    : [
        {
          id: 1,
          driverId: defaultDriverId,
          date: defaultDate || todayIso(),
          rows: Array.from({ length: INITIAL_ROWS }, (_, i) => ({ id: i + 1 }))
        }
      ];
  const [groups, setGroups] = React.useState<GroupSlot[]>(initialGroups);
  const nextGroupId = React.useRef(initialGroups.length + 1);
  // "<groupId>:<rowId>" -> current pay value, for per-group and grand totals
  const [pays, setPays] = React.useState<Record<string, string>>({});
  // groupId -> live row count (rows live inside GroupBlock once mounted)
  const [rowCounts, setRowCounts] = React.useState<Record<number, number>>(() =>
    Object.fromEntries(initialGroups.map(g => [g.id, g.rows.length]))
  );
  // Live drag source across groups (groupId gates which sheet accepts the drop)
  const [dragging, setDragging] = React.useState<{ groupId: number; rowId: number } | null>(null);
  // Whether the user has changed anything (guards photo-import replacement)
  const dirtyRef = React.useRef(false);

  // Persist dragged column widths for the next session
  React.useEffect(() => {
    try {
      window.localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths));
    } catch {
      // Storage unavailable (private mode) -> widths stay session-only
    }
  }, [colWidths]);

  const totalRows = Object.values(rowCounts).reduce((acc, n) => acc + n, 0);
  const totalPay = Object.values(pays).reduce((acc, v) => acc + (Number(v) || 0), 0);

  /** Drag a column edge: pointer capture on the handle, width clamped per column */
  const startResize = React.useCallback(
    (e: React.PointerEvent<HTMLSpanElement>, colIndex: number) => {
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = colWidths[colIndex];
      const min = COLUMNS[colIndex].min;
      const onMove = (ev: PointerEvent) => {
        const next = Math.max(min, Math.round(startWidth + ev.clientX - startX));
        setColWidths(current =>
          current[colIndex] === next ? current : current.map((v, i) => (i === colIndex ? next : v))
        );
      };
      const onUp = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [colWidths]
  );

  const handlePayChange = React.useCallback((groupId: number, rowId: number, value: string) => {
    setPays(current => {
      const key = `${groupId}:${rowId}`;
      // Same value -> skip re-render churn from many rows
      if (current[key] === value) return current;
      return { ...current, [key]: value };
    });
  }, []);

  const handleForgetRow = React.useCallback((groupId: number, rowId: number) => {
    setPays(current => {
      const key = `${groupId}:${rowId}`;
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const handleRowsChange = React.useCallback((groupId: number, count: number) => {
    setRowCounts(current =>
      current[groupId] === count ? current : { ...current, [groupId]: count }
    );
  }, []);

  const handleDirty = React.useCallback(() => {
    dirtyRef.current = true;
  }, []);

  function addGroup() {
    dirtyRef.current = true;
    const id = nextGroupId.current++;
    setGroups(current => [
      ...current,
      { id, driverId: "", date: todayIso(), rows: [{ id: 1 }] }
    ]);
  }

  function removeGroup(id: number) {
    dirtyRef.current = true;
    setGroups(current => current.filter(g => g.id !== id));
    setRowCounts(current => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPays(current => {
      const prefix = `${id}:`;
      const keys = Object.keys(current);
      if (!keys.some(k => k.startsWith(prefix))) return current;
      return Object.fromEntries(keys.filter(k => !k.startsWith(prefix)).map(k => [k, current[k]]));
    });
  }

  function groupPaySum(id: number) {
    const prefix = `${id}:`;
    return Object.entries(pays).reduce(
      (acc, [key, v]) => (key.startsWith(prefix) ? acc + (Number(v) || 0) : acc),
      0
    );
  }

  /**
   * Drop one recognized photo sheet in as a group (one driver, rows keep their
   * own dates). Appends after anything typed; only an untouched form is
   * replaced wholesale - appending never destroys input, so no confirm.
   */
  function applyFromPhoto(apply: PhotoApply) {
    const date = apply.rows.find(r => r.date)?.date || todayIso();
    const id = nextGroupId.current++;
    const rows: RowSlot[] = apply.rows.map((row, i) => ({
      id: i + 1,
      defaults: {
        trip_date: row.date,
        operation: row.operation,
        from: row.from,
        to: row.to,
        load_no: row.load_no,
        miles: "0",
        pay_amount: "",
        notes: row.notes
      }
    }));
    const group: GroupSlot = { id, driverId: apply.driverId, date, rows };
    if (dirtyRef.current) {
      setGroups(current => [...current, group]);
    } else {
      setGroups([group]);
      setPays({});
    }
    dirtyRef.current = true;
    setPhotoOpen(false);
  }

  return (
    <form
      action={addTripsBatch}
      aria-label="录入行程"
      onChange={e => {
        // Photo-panel events bubble too (it lives inside the form); those
        // don't make the entry rows dirty
        if (!(e.target as HTMLElement).closest("[data-photo-panel]")) dirtyRef.current = true;
      }}
    >
      <div className="panel">
        <div className="panel-cap">
          <span>按司机分组：每组一位司机，每行可单独改日期</span>
          <button type="button" className="linklike" onClick={() => setPhotoOpen(true)}>
            <CameraIcon className="mr-1 inline size-3.5" />
            照片识别
          </button>
        </div>

        <PhotoImport
          drivers={drivers}
          locations={locations}
          open={photoOpen}
          onOpenChange={setPhotoOpen}
          onApply={applyFromPhoto}
        />

        <div className="table-wrap">
          <table className="roster table-fixed w-full">
            <colgroup>
              <col style={{ width: HANDLE_COL_W }} />
              {COLUMNS.map((column, i) => (
                <col key={column.key} style={{ width: colWidths[i] }} />
              ))}
              <col style={{ width: ACTIONS_COL_W }} />
            </colgroup>
            <thead>
              <tr>
                <th className="px-1" aria-label="排序" />
                {COLUMNS.map((column, i) => (
                  <th key={column.key} className={`col-th px-1.5${column.num ? " num" : ""}`}>
                    {column.label}
                    <span
                      className="col-resizer"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`调整「${column.label}」列宽`}
                      onPointerDown={e => startResize(e, i)}
                    />
                  </th>
                ))}
                <th className="px-1.5">删除</th>
              </tr>
            </thead>
            {groups.map((group, gi) => (
              <GroupSection
                key={group.id}
                index={gi}
                group={group}
                drivers={drivers}
                locations={locations}
                removable={groups.length > 1}
                onRemove={() => removeGroup(group.id)}
                onPayChange={(rowId, value) => handlePayChange(group.id, rowId, value)}
                onForgetRow={rowId => handleForgetRow(group.id, rowId)}
                onRowsChange={count => handleRowsChange(group.id, count)}
                onDirty={handleDirty}
                dragging={dragging}
                onDraggingChange={setDragging}
                paySum={groupPaySum(group.id)}
              />
            ))}
          </table>
        </div>

        <input type="hidden" name="group_count" value={groups.length} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" className="h-8" onClick={addGroup}>
              <PlusIcon className="size-4" />
              添加一组（换司机）
            </Button>
            <span className="text-xs text-muted-foreground">
              共 {groups.length} 组 · {totalRows} 段 · 工资合计 <b className="font-mono">{money(totalPay)}</b>
            </span>
          </div>
          <Button type="submit" className="h-9 px-5">记入 {totalRows} 段行程</Button>
        </div>
      </div>
    </form>
  );
}
