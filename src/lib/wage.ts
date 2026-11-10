import type { DriverType, LocationType, OperationType } from "@/lib/labels";

/** One trip endpoint, just enough to price a leg (BASE handling + standard pay). */
export type WageEndpoint = {
  location_type: LocationType;
  standard_pay_amount: number;
};

/** Round to cents so the controlled input and numeric(12,2) stay in sync. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Driver-price mileage tiers (CA local pickup/delivery):
 *   m <= 0 -> $0 | 1-49 -> $50 | 50-99 -> $80 | 100-149 -> $120 | 150-199 -> $150
 *   every extra 50 mi past 150 adds $30: floor(m/50)=k>=3 -> 150 + 30*(k-3)
 * The owner column of the table is exactly 2x at every band, so the OWNER
 * multiplier covers it.
 */
export function mileageTierWage(miles: number): number {
  if (!Number.isFinite(miles) || miles <= 0) return 0;
  const k = Math.floor(miles / 50);
  if (k <= 0) return 50;
  if (k === 1) return 80;
  if (k === 2) return 120;
  return 150 + 30 * (k - 3);
}

/**
 * Base wage before multipliers:
 * - an endpoint of type BASE prices the leg by the OTHER end's
 *   standard_pay_amount (from-BASE wins when both ends are BASE: price by `to`);
 * - when the pricing counterpart is missing (not picked yet) -> $0;
 * - neither end is BASE -> mileage tier on `miles`.
 */
export function resolveBaseWage(
  miles: number,
  from?: WageEndpoint | null,
  to?: WageEndpoint | null
): number {
  if (from?.location_type === "BASE") return to?.standard_pay_amount ?? 0;
  if (to?.location_type === "BASE") return from?.standard_pay_amount ?? 0;
  return mileageTierWage(miles);
}

/**
 * Full per-trip wage: base x (OWNER ? 2 : 1) x (BOBTAIL ? 0.5 : 1).
 * DEL / LIVE / EMPTY bill at full price; an unpicked driverType/operation
 * counts as DRIVER / full price.
 */
export function calcTripWage(input: {
  driverType?: DriverType;
  operation?: OperationType;
  miles: number;
  from?: WageEndpoint | null;
  to?: WageEndpoint | null;
}): number {
  const base = resolveBaseWage(input.miles, input.from, input.to);
  const ownerX = input.driverType === "OWNER" ? 2 : 1;
  const bobtailX = input.operation === "BOBTAIL" ? 0.5 : 1;
  return roundCents(base * ownerX * bobtailX);
}
