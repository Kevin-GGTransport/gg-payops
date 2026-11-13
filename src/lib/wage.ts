import type { DriverType, LocationType, OperationType } from "@/lib/labels";

/** One trip endpoint, just enough to price a leg (BASE handling + standard pay). */
export type WageEndpoint = {
  location_type: LocationType;
  standard_pay_amount: number;
};

/** One mileage band of a wage-rule version: legs at/above miles_from bill `amount`. */
export type WageTier = {
  miles_from: number;
  amount: number;
};

/** Fixed-price postal pair (e.g. 94545 <-> 99301): either direction bills one_way_amount. */
export type WageSpecialRoute = {
  from_postal: string;
  to_postal: string;
  one_way_amount: number;
};

/** Everything a wage-rule version contributes to pricing (from pay.wage_rule_*). */
export type WageRuleData = {
  id: string;
  name: string;
  effective_from: string;
  owner_multiplier: number;
  bobtail_multiplier: number;
  overage_increment: number;
  tiers: WageTier[];
  special_routes: WageSpecialRoute[];
};

/** Round to cents so the controlled input and numeric(12,2) stay in sync. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Driver-price mileage tiers (CA local pickup/delivery): the leg falls in the
 * highest tier whose miles_from <= miles; past the top tier every extra 50mi
 * adds overage_increment
 * (e.g. top 250->$210 with +$30: 299->$210, 300->$240, 350->$270).
 */
export function mileageTierWage(
  miles: number,
  tiers: WageTier[],
  overageIncrement: number
): number {
  if (!Number.isFinite(miles) || miles <= 0 || tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.miles_from - b.miles_from);
  let matched = sorted[0];
  for (const tier of sorted) {
    if (miles >= tier.miles_from) matched = tier;
    else break;
  }
  const bands = Math.floor(miles / 50) - Math.floor(matched.miles_from / 50);
  const base = Number(matched.amount);
  return roundCents(bands > 0 ? base + overageIncrement * bands : base);
}

/** Fixed price for a special postal pair in either direction; null = no match. */
export function resolveSpecialRoute(
  fromPostal: string | null | undefined,
  toPostal: string | null | undefined,
  specialRoutes: WageSpecialRoute[]
): number | null {
  if (!fromPostal || !toPostal) return null;
  for (const route of specialRoutes) {
    const direct = fromPostal === route.from_postal && toPostal === route.to_postal;
    const reverse = fromPostal === route.to_postal && toPostal === route.from_postal;
    if (direct || reverse) return Number(route.one_way_amount);
  }
  return null;
}

/**
 * Pick the version governing a trip date: the latest ACTIVE version with
 * effective_from <= tripDate (null when none covers the date).
 */
export function pickVersion<T extends { effective_from: string }>(
  versions: T[],
  tripDate: string
): T | null {
  let best: T | null = null;
  for (const version of versions) {
    if (
      version.effective_from <= tripDate &&
      (!best || version.effective_from > best.effective_from)
    ) {
      best = version;
    }
  }
  return best;
}

/**
 * Base wage before multipliers:
 * 1. a BASE endpoint prices the leg at HALF the OTHER end's standard_pay_amount
 *    (a base round trip is one warehouse run = the full amount once, so a
 *    single leg bills 50%; from-BASE wins when both ends are BASE: price by
 *    `to`). An unpriced counterpart (0/unset, incl. free-text ends) does NOT
 *    bill $0 - the leg falls through to 2/3 instead;
 * 2. else a special postal pair bills its fixed price (zip-only legs);
 * 3. else the mileage tier table + overage increment.
 */
function resolveBaseWage(input: {
  miles: number;
  from?: WageEndpoint | null;
  to?: WageEndpoint | null;
  fromPostal?: string | null;
  toPostal?: string | null;
  rule: WageRuleData;
}): number {
  // Half of the counterpart amount, unrounded: calcTripWage rounds the final
  // product, which keeps a round trip (two halves x multipliers) exact
  if (input.from?.location_type === "BASE") {
    const amount = input.to?.standard_pay_amount ?? 0;
    if (amount > 0) return amount / 2;
  } else if (input.to?.location_type === "BASE") {
    const amount = input.from?.standard_pay_amount ?? 0;
    if (amount > 0) return amount / 2;
  }
  const special = resolveSpecialRoute(
    input.fromPostal,
    input.toPostal,
    input.rule.special_routes
  );
  if (special !== null) return special;
  return mileageTierWage(input.miles, input.rule.tiers, input.rule.overage_increment);
}

/**
 * Full per-trip wage against a rule version:
 * base x (OWNER ? owner_multiplier : 1) x (BOBTAIL ? bobtail_multiplier : 1),
 * rounded to cents. DEL / LIVE / EMPTY bill at full price; an unpicked
 * driverType/operation counts as DRIVER / full price.
 */
export function calcTripWage(input: {
  driverType?: DriverType;
  operation?: OperationType;
  miles: number;
  from?: WageEndpoint | null;
  to?: WageEndpoint | null;
  fromPostal?: string | null;
  toPostal?: string | null;
  rule: WageRuleData;
}): number {
  const base = resolveBaseWage(input);
  const ownerX = input.driverType === "OWNER" ? input.rule.owner_multiplier : 1;
  const bobtailX = input.operation === "BOBTAIL" ? input.rule.bobtail_multiplier : 1;
  return roundCents(base * ownerX * bobtailX);
}
