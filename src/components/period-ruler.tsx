import Link from "next/link";
import { periodDays, periodLabel, type Period } from "@/lib/period";
import { cn } from "@/lib/utils";

const arrowClass =
  "grid w-8 shrink-0 place-items-center rounded-md border border-line bg-card font-mono text-base text-route no-underline transition-colors hover:border-route hover:bg-muted/40";

export function PeriodRuler({
  period,
  prevHref,
  nextHref,
  todayIso
}: {
  period: Period;
  prevHref: string;
  nextHref: string;
  todayIso: string;
}) {
  const days = periodDays(period, todayIso);
  return (
    <nav aria-label="核算周期" className="period-ruler mb-4 flex items-stretch gap-2.5 rounded-md border border-line bg-card p-3">
      <Link href={prevHref} aria-label="上一周期" className={arrowClass}>
        ‹
      </Link>
      <div className="ruler-scale relative grid flex-1 grid-cols-7">
        {days.map(day => (
          <div
            key={day.iso}
            className={cn(
              "relative grid justify-items-center gap-0.5 py-1.5",
              day.iso !== days[0].iso && "border-l border-line",
              day.isToday && "bg-amber-50"
            )}
          >
            <span className="max-sm:text-[10px] text-[11px] text-muted-foreground">{day.dow}</span>
            <b className={cn(
              "font-mono text-[15px] font-semibold tabular-nums leading-tight sm:text-[17px]",
              day.isToday && "text-navy"
            )}>
              {day.day}
            </b>
            {day.isToday && <i aria-label="今天" className="absolute bottom-0.5 size-1 rounded-full bg-amber" />}
          </div>
        ))}
      </div>
      <Link href={nextHref} aria-label="下一周期" className={arrowClass}>
        ›
      </Link>
      <span className="hidden self-center whitespace-nowrap px-1 font-mono text-xs tabular-nums text-muted-foreground md:block">
        {periodLabel(period)}
      </span>
    </nav>
  );
}
