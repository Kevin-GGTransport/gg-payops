import { dateIso, todayIso } from "./format";

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

/** Period containing today (US Pacific business day) */
export function currentPeriod(): Period {
  return periodOf(todayIso());
}

/**
 * Working period: the week that just closed. Entry and payroll default here -
 * a week's trips are entered and verified after it ends, so the previous
 * period is where work actually happens.
 */
export function defaultPeriod(): Period {
  return shiftPeriod(currentPeriod(), -1);
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
