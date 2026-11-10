"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type PeriodPickerProps = {
  /** ISO date of the selected period's start (a Saturday) */
  selectedStart: string;
  /** Human label of the selected period, shown in the trigger */
  selectedLabel: string;
  todayIso: string;
  /** Per-period wage totals keyed by period start ISO date */
  totals: Record<string, { legs: number; pay: number }>;
};

// Saturday-first: every grid row is exactly one payroll period (Sat ~ Fri)
const DOW = ["六", "日", "一", "二", "三", "四", "五"];
const WEEKS = 6;

function isoOf(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** $1,234 for whole dollars, $1,234.50 when cents matter */
function payShort(pay: number) {
  return `$${pay.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(pay) ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

/**
 * Period calendar picker: a month grid where each row is one Sat~Fri payroll
 * period; clicking any day jumps to that period. A trailing column shows the
 * period's wage total straight from the trips ledger.
 */
export function PeriodPicker({ selectedStart, selectedLabel, todayIso, totals }: PeriodPickerProps) {
  const initial = selectedStart.split("-");
  const [cursor, setCursor] = React.useState({
    y: Number(initial[0]),
    m: Number(initial[1]) - 1
  });

  function shiftMonth(delta: number) {
    setCursor(({ y, m }) => {
      const total = y * 12 + m + delta;
      return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
    });
  }

  // Grid starts at the Saturday on or before the 1st of the month
  const first = new Date(cursor.y, cursor.m, 1);
  const offset = (first.getDay() + 1) % 7; // Sat=0 … Fri=6
  const gridStart = new Date(cursor.y, cursor.m, 1 - offset);

  const weeks = Array.from({ length: WEEKS }, (_, w) => {
    const days = Array.from({ length: 7 }, (_, d) => {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7 + d);
      return {
        iso: isoOf(date.getFullYear(), date.getMonth(), date.getDate()),
        day: date.getDate(),
        inMonth: date.getMonth() === cursor.m
      };
    });
    return { start: days[0].iso, days };
  });

  return (
    <Popover>
      <PopoverTrigger
        className="filter-select flex items-center gap-2 font-mono tabular-nums"
        aria-label="选择核算周期"
      >
        <CalendarDaysIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        {selectedLabel}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1.5">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="上个月"
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </button>
          <b className="font-mono text-sm font-semibold tabular-nums">
            {cursor.y} 年 {cursor.m + 1} 月
          </b>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="下个月"
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-8 border-b border-line px-1 py-1 text-center text-[10px] font-semibold tracking-wider text-muted-foreground">
          {DOW.map(dow => <span key={dow}>{dow}</span>)}
          <span className="text-right pr-1">工资</span>
        </div>

        <div className="p-1">
          {weeks.map(week => {
            const isSelected = week.start === selectedStart;
            const total = totals[week.start];
            return (
              <div
                key={week.start}
                className={cn(
                  "relative grid grid-cols-8 items-center rounded-sm",
                  isSelected && "bg-route/10"
                )}
              >
                {isSelected && (
                  <i aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-navy" />
                )}
                {week.days.map(day => (
                  <Link
                    key={day.iso}
                    href={`/dashboard/payroll?period=${week.start}`}
                    aria-label={`周期 ${week.start}`}
                    className={cn(
                      "grid h-8 place-items-center rounded-md font-mono text-sm tabular-nums no-underline hover:bg-muted",
                      day.inMonth ? "text-foreground" : "text-muted-foreground/40",
                      day.iso === todayIso && "bg-amber/15 font-bold text-amber",
                      isSelected && "font-semibold"
                    )}
                  >
                    {day.day}
                  </Link>
                ))}
                <span
                  className={cn(
                    "pr-1.5 text-right font-mono text-[11px] tabular-nums",
                    total ? "text-muted-foreground" : "text-muted-foreground/30",
                    isSelected && total && "font-semibold text-navy"
                  )}
                >
                  {total ? payShort(total.pay) : "—"}
                </span>
              </div>
            );
          })}
        </div>
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted-foreground">
          每行 = 一个核算周期（周六 ~ 周五），点任意日期切换
        </p>
      </PopoverContent>
    </Popover>
  );
}
