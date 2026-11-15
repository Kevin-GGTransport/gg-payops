"use client";

import * as React from "react";
import { zhCN } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from "@/components/ui/input-group";

/* ISO <-> Date without timezone drift: trip dates are date-only strings, so
   both directions go through local Y/M/D construction - never toISOString
   (UTC), which shifts the day for anyone outside UTC. */

function isoToDate(iso: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateToIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Parse typed text into ISO. Accepts the full form plus the short forms a
 * clerk actually types: "11/14", "11-14", "11/14/26" (missing year = current).
 * Returns "" for empty input, null for unparseable text.
 */
export function parseDateText(raw: string, defaultYear = new Date().getFullYear()): string | null {
  const text = raw.trim();
  if (!text) return "";
  const full = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  const short = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/.exec(text);
  let y: number, m: number, d: number;
  if (full) {
    y = Number(full[1]);
    m = Number(full[2]);
    d = Number(full[3]);
  } else if (short) {
    m = Number(short[1]);
    d = Number(short[2]);
    const year = short[3] ? Number(short[3]) : defaultYear;
    y = year < 100 ? 2000 + year : year;
  } else {
    return null;
  }
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return dateToIso(date);
}

type DateFieldProps = {
  /** Field label; omit inside tables (the column header already labels it) */
  label?: string;
  /** Form field name; the ISO YYYY-MM-DD value submits via a hidden input */
  name: string;
  defaultValue?: string;
  /** Controlled ISO value ("" = empty); the picker stops keeping its own state */
  value?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Notified on every committed change (typed parse or calendar pick), "" = cleared */
  onValueChange?: (iso: string) => void;
  /** Compact h-8 for dense table rows (default h-9) */
  size?: "sm" | "default";
  className?: string;
  /** Extra classes on the input group itself (height tweaks in filter rows) */
  groupClassName?: string;
  "aria-label"?: string;
};

/**
 * Date input the shadcn way (official date-picker-input pattern): a typed
 * InputGroup input plus an embedded calendar button opening a Calendar
 * popover. Accepts "2026-11-14" and short "11/14" forms on the keyboard;
 * ArrowDown opens the calendar. Submits ISO via a hidden input.
 */
export function DateField({
  label,
  name,
  defaultValue = "",
  value: valueProp,
  required,
  disabled,
  placeholder = "选择日期",
  onValueChange,
  size = "default",
  className,
  groupClassName,
  ...rest
}: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [internalIso, setInternalIso] = React.useState(defaultValue);
  const isControlled = valueProp !== undefined;
  const iso = isControlled ? valueProp : internalIso;
  const date = isoToDate(iso);
  // Typed text lives separately: invalid keystrokes must not clobber the
  // committed value; the unfocused box simply derives from the committed ISO
  const [text, setText] = React.useState(iso);
  const [focused, setFocused] = React.useState(false);
  // Month the user browsed to inside the open popover. It wins while set so
  // paging around is never yanked back by the committed date; dropping it on
  // close re-anchors the next open on the value
  const [browsedMonth, setBrowsedMonth] = React.useState<Date | undefined>(undefined);
  const month = browsedMonth ?? date;

  function commit(next: string) {
    if (!isControlled) setInternalIso(next);
    setText(next);
    onValueChange?.(next);
  }

  return (
    <div className={cn(label && "grid gap-1.5 text-xs font-medium text-muted-foreground", className)}>
      {label && <span>{label}</span>}
      <input type="hidden" name={name} value={iso} required={required} />
      <Popover
        open={open}
        onOpenChange={next => {
          setOpen(next);
          // Drop the browsed month on close so reopening lands on the value
          if (!next) setBrowsedMonth(undefined);
        }}
      >
        <InputGroup
          data-empty={!iso}
          aria-label={rest["aria-label"] ?? (label ? `选择${label}` : undefined)}
          className={cn(
            size === "sm" && "h-8",
            // Site focus color is route blue (Button/Input primitives); the
            // official group focus is neutral ring - override with important
            // so it reliably beats the primitive's own has-focus utilities
            "has-[[data-slot=input-group-control]:focus-visible]:border-route! has-[[data-slot=input-group-control]:focus-visible]:ring-2! has-[[data-slot=input-group-control]:focus-visible]:ring-route/30!",
            disabled && "opacity-50",
            groupClassName
          )}
        >
          <InputGroupInput
            value={focused ? text : iso || ""}
            placeholder={placeholder}
            disabled={disabled}
            inputMode="numeric"
            className={cn("font-mono tabular-nums", size === "sm" && "h-8 text-[13px]")}
            onChange={e => {
              setText(e.target.value);
              const parsed = parseDateText(e.target.value);
              if (parsed !== null) commit(parsed);
            }}
            onFocus={() => {
              setText(iso);
              setFocused(true);
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={e => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <PopoverTrigger asChild>
              <InputGroupButton
                variant="ghost"
                size={size === "sm" ? "icon-xs" : "icon-sm"}
                aria-label="打开日历"
                disabled={disabled}
              >
                <CalendarIcon className="size-3.5 opacity-60" />
              </InputGroupButton>
            </PopoverTrigger>
          </InputGroupAddon>
        </InputGroup>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start" sideOffset={6}>
          <Calendar
            mode="single"
            locale={zhCN}
            selected={date}
            month={month}
            onMonthChange={setBrowsedMonth}
            onSelect={day => {
              if (day) {
                commit(dateToIso(day));
                setOpen(false);
              }
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
