import type { DriverType, LocationType, OperationType } from "@/lib/labels";

/** One trip endpoint, just enough to price a leg (rule matching + standard pay). */
export type WageEndpoint = {
  location_type: LocationType;
  standard_pay_amount: number;
  /** Location code (STK / HW / SHIPPER matchers); null for free-text ends */
  code: string | null;
  /** Amazon warehouse class, drives AMAZON_A / AMAZON_B matchers */
  amazon_class: "A" | "B" | null;
};

/** Billing unit of a flexible price rule (pay.wage_rule_prices.unit) */
export type WagePriceUnit = "LEG" | "ROUND_TRIP" | "DAY";

/**
 * One flexible price rule (pay.wage_rule_prices): a per-leg fixed price or a
 * package suggestion. from_class / to_class match endpoint classes
 * (STK, HW, SHIPPER, AMAZON_A, AMAZON_B) as an unordered pair, NULL = any
 * side; operation NULL = any operation; driver_id NULL = all drivers.
 */
export type WagePriceRule = {
  id: string;
  driver_id: string | null;
  unit: WagePriceUnit;
  from_class: string | null;
  to_class: string | null;
  operation: string | null;
  label: string | null;
  driver_amount: number;
  owner_amount: number | null;
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
  price_rules: WagePriceRule[];
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

/** Endpoint -> matcher class; null when the end matches no named class. */
export function wageClassOf(endpoint: WageEndpoint | null | undefined): string | null {
  if (!endpoint) return null;
  if (endpoint.code === "STK" || endpoint.code === "HW" || endpoint.code === "SHIPPER") {
    return endpoint.code;
  }
  if (endpoint.location_type === "AMAZON") {
    if (endpoint.amazon_class === "A") return "AMAZON_A";
    if (endpoint.amazon_class === "B") return "AMAZON_B";
  }
  return null;
}

/**
 * Specificity score for rule ranking: driver-scoped beats global,
 * operation-constrained beats open, class-constrained beats wide. Ties keep
 * insertion order (stable sort by id ascending first).
 */
function ruleSpecificity(rule: WagePriceRule): number {
  return (
    (rule.driver_id !== null ? 4 : 0) +
    (rule.operation !== null ? 2 : 0) +
    (rule.from_class !== null || rule.to_class !== null ? 1 : 0)
  );
}

/** Does one endpoint pair satisfy a rule's from/to classes (unordered)? */
function classesMatch(
  fromClass: string | null,
  toClass: string | null,
  rule: WagePriceRule
): boolean {
  if (!rule.from_class && !rule.to_class) return true;
  const direct = rule.from_class === fromClass && rule.to_class === toClass;
  const reverse = rule.from_class === toClass && rule.to_class === fromClass;
  // A single-sided rule (e.g. any -> SHIPPER) matches when that side matches
  const fromOnly = rule.from_class !== null && rule.to_class === null && rule.from_class === fromClass;
  const toOnly = rule.to_class !== null && rule.from_class === null && rule.to_class === toClass;
  return direct || reverse || fromOnly || toOnly;
}

/**
 * All rules matching a leg, most specific first. Driver scope: driver-scoped
 * rules only match that driver id; global rules match everyone.
 */
export function matchingLegRules(input: {
  driverId?: string | null;
  operation?: OperationType;
  from?: WageEndpoint | null;
  to?: WageEndpoint | null;
  rules: WagePriceRule[];
}): WagePriceRule[] {
  const fromClass = wageClassOf(input.from);
  const toClass = wageClassOf(input.to);
  return input.rules
    .filter(rule => rule.unit === "LEG")
    .filter(rule => rule.driver_id === null || rule.driver_id === input.driverId)
    .filter(rule => rule.operation === null || rule.operation === input.operation)
    .filter(rule => classesMatch(fromClass, toClass, rule))
    .sort((a, b) => ruleSpecificity(b) - ruleSpecificity(a));
}

/**
 * Best package rule (ROUND_TRIP / DAY) to suggest for a driver; driver-scoped
 * beats global, later rows beat earlier ties (list keeps insertion order).
 */
export function matchPackageRule(
  unit: Exclude<WagePriceUnit, "LEG">,
  driverId: string | null | undefined,
  rules: WagePriceRule[]
): WagePriceRule | null {
  let best: WagePriceRule | null = null;
  for (const rule of rules) {
    if (rule.unit !== unit) continue;
    if (rule.driver_id !== null && rule.driver_id !== driverId) continue;
    if (!best) {
      best = rule;
      continue;
    }
    const scoped = rule.driver_id !== null;
    const bestScoped = best.driver_id !== null;
    if (scoped !== bestScoped ? scoped : true) best = rule;
  }
  return best;
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
 * 1. the most specific matching LEG price rule wins outright - its amount is
 *    the final driver/owner price, multipliers never apply (two explicit
 *    columns in the rule table; a missing owner column falls back to
 *    driver_amount x owner_multiplier);
 * 2. a BASE endpoint prices the leg at HALF the OTHER end's standard_pay_amount
 *    (a base round trip is one warehouse run = the full amount once, so a
 *    single leg bills 50%; from-BASE wins when both ends are BASE: price by
 *    `to`). An unpriced counterpart (0/unset, incl. free-text ends) does NOT
 *    bill $0 - the leg falls through to 3/4 instead;
 * 3. a special postal pair bills its fixed price (zip-only legs);
 * 4. the mileage tier table + overage increment.
 */
function resolveBaseWage(input: {
  driverId?: string | null;
  driverType?: DriverType;
  operation?: OperationType;
  miles: number;
  from?: WageEndpoint | null;
  to?: WageEndpoint | null;
  fromPostal?: string | null;
  toPostal?: string | null;
  rule: WageRuleData;
}): { amount: number; fixed: boolean } {
  // Explicit LEG rule: fixed final price, class/operation/driver matched by
  // specificity (driver-scoped > global, operation-constrained > open)
  const legRule = matchingLegRules({ ...input, rules: input.rule.price_rules })[0];
  if (legRule) {
    // Owner column when negotiated; otherwise driver price x owner multiplier
    const amount =
      input.driverType === "OWNER"
        ? (legRule.owner_amount ?? legRule.driver_amount * input.rule.owner_multiplier)
        : legRule.driver_amount;
    return { amount, fixed: true };
  }
  // Half of the counterpart amount, unrounded: calcTripWage rounds the final
  // product, which keeps a round trip (two halves x multipliers) exact
  if (input.from?.location_type === "BASE") {
    const amount = input.to?.standard_pay_amount ?? 0;
    if (amount > 0) return { amount: amount / 2, fixed: false };
  } else if (input.to?.location_type === "BASE") {
    const amount = input.from?.standard_pay_amount ?? 0;
    if (amount > 0) return { amount: amount / 2, fixed: false };
  }
  const special = resolveSpecialRoute(
    input.fromPostal,
    input.toPostal,
    input.rule.special_routes
  );
  if (special !== null) return { amount: special, fixed: false };
  return {
    amount: mileageTierWage(input.miles, input.rule.tiers, input.rule.overage_increment),
    fixed: false
  };
}

/**
 * Full per-trip wage against a rule version:
 * base x (OWNER ? owner_multiplier : 1) x (BOBTAIL ? bobtail_multiplier : 1),
 * rounded to cents. A matched fixed-price LEG rule bypasses both multipliers.
 * DEL / LIVE / EMPTY bill at full price; an unpicked driverType/operation
 * counts as DRIVER / full price.
 */
export function calcTripWage(input: {
  driverId?: string | null;
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
  if (base.fixed) return roundCents(base.amount);
  const ownerX = input.driverType === "OWNER" ? input.rule.owner_multiplier : 1;
  const bobtailX = input.operation === "BOBTAIL" ? input.rule.bobtail_multiplier : 1;
  return roundCents(base.amount * ownerX * bobtailX);
}
