/** Money: $1,234.50 */
export function money(value: string | number | null | undefined) {
  return `$${Number(value ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/** Miles: 1,234 */
export function miles(value: string | number | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Fuel gallons: 12.5 (0 shows as a muted dash - most legs fuel nothing; unit lives in the header) */
export function fuel(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  return n > 0 ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—";
}

/** Odometer reading with one decimal: 12,345.6 mi */
export function odometerMi(value: string | number | null | undefined) {
  return value === null || value === undefined
    ? null
    : `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`;
}

/** Full address: street, city, state zip (empty segments skipped) */
export function fullAddress(fields: {
  address_line: string | null;
  city: string | null;
  state_code: string | null;
  postal_code: string | null;
}) {
  const region = [fields.state_code, fields.postal_code].filter(Boolean).join(" ");
  return [fields.address_line, fields.city, region].filter(Boolean).join(", ");
}

/** Local date as YYYY-MM-DD */
export function dateIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Business "today" in US Pacific time (the fleet's home base) as YYYY-MM-DD */
export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

/** Calendar arithmetic on YYYY-MM-DD strings (no timezone drift) */
export function isoPlusDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Days from today (negative = past) */
export function daysUntil(date: string) {
  return Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.now()) / 86_400_000);
}

/** This week's Monday ~ Sunday */
export function currentWeekRange() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: dateIso(monday), end: dateIso(sunday) };
}
