import { dateIso } from "./format";

export type Period = { start: string; end: string };

/**
 * 核算周期：周六 ~ 下周五。
 * 任意日期归属到所在周期：周期起点 = 该日期往前最近的周六。
 */
export function periodOf(date: string): Period {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 1) % 7; // 周六=0、周日=1、…、周五=6
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - offset);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: dateIso(start), end: dateIso(end) };
}

/** 今天所在的周期 */
export function currentPeriod(): Period {
  return periodOf(dateIso(new Date()));
}

/** 周期平移：n=1 下一个周期，n=-1 上一个周期 */
export function shiftPeriod(period: Period, weeks: number): Period {
  const base = new Date(`${period.start}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + weeks * 7);
  return periodOf(dateIso(base));
}

/** 周期显示：10/17 ~ 10/23 */
export function periodLabel(period: Period): string {
  const fmt = (iso: string) => iso.slice(5).replace("-", "/");
  return `${fmt(period.start)} ~ ${fmt(period.end)}`;
}

/** 周期标尺的 7 天刻度 */
export function periodDays(period: Period, todayIso: string) {
  const DOW = ["日", "一", "二", "三", "四", "五", "六"];
  const start = new Date(`${period.start}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = dateIso(d);
    return { iso, day: iso.slice(8), dow: DOW[d.getUTCDay()], isToday: iso === todayIso };
  });
}
