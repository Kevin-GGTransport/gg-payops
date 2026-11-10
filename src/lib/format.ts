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
