import type { DriverType, OperationType } from "@/lib/labels";

/**
 * One trip endpoint for pricing: the picked dictionary location. Free-text
 * ends resolve to null - they match no rule and fall to the mileage tiers.
 */
export type WageEndpoint = { id: string } | null;

/** Billing unit of a price rule (pay.wage_rule_prices.unit) */
export type WagePriceUnit = "LEG" | "ROUND_TRIP" | "DAY";

/**
 * One price rule (pay.wage_rule_prices) - the ONLY pricing primitive:
 * 适用司机 (NULL = everyone) x 起点/终点 (dictionary locations, unordered
 * pair, NULL side = any) x 操作 (NULL = any) x unit x driver price x owner
 * price (NULL = driver price x owner multiplier). LEG prices one leg as a
 * final price; ROUND_TRIP / DAY suggest package prices in the entry sheet.
 */
export type WagePriceRule = {
  id: string;
  driver_id: string | null;
  unit: WagePriceUnit;
  from_location_id: string | null;
  to_location_id: string | null;
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

/** Everything a wage-rule version contributes to pricing (from pay.wage_rule_*). */
export type WageRuleData = {
  id: string;
  name: string;
  effective_from: string;
  owner_multiplier: number;
  bobtail_multiplier: number;
  overage_increment: number;
  tiers: WageTier[];
  price_rules: WagePriceRule[];
};

/** Round to cents so the controlled input and numeric(12,2) stay in sync. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Driver-price mileage tiers (the fallback when no rule matches): the leg
 * falls in the highest tier whose miles_from <= miles; past the top tier
 * every extra 50mi adds overage_increment
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

/**
 * Specificity score for rule ranking: driver-scoped beats global,
 * operation-constrained beats open, more pinned endpoints beat wider. Ties
 * keep insertion order (stable sort).
 */
function ruleSpecificity(rule: WagePriceRule): number {
  return (
    (rule.driver_id !== null ? 4 : 0) +
    (rule.operation !== null ? 2 : 0) +
    (rule.from_location_id !== null ? 1 : 0) +
    (rule.to_location_id !== null ? 1 : 0)
  );
}

/** Does one endpoint pair satisfy a rule's from/to locations (unordered)? */
function locationsMatch(
  from: WageEndpoint,
  to: WageEndpoint,
  rule: WagePriceRule
): boolean {
  if (!rule.from_location_id && !rule.to_location_id) return true;
  const fromId = from?.id ?? null;
  const toId = to?.id ?? null;
  const direct = rule.from_location_id === fromId && rule.to_location_id === toId;
  const reverse = rule.from_location_id === toId && rule.to_location_id === fromId;
  // Single-sided rules (e.g. any -> SHIPPER) match when that side matches
  const fromOnly =
    rule.from_location_id !== null && rule.to_location_id === null && rule.from_location_id === fromId;
  const toOnly =
    rule.to_location_id !== null && rule.from_location_id === null && rule.to_location_id === toId;
  return direct || reverse || fromOnly || toOnly;
}

/**
 * All LEG rules matching a leg, most specific first. Driver scope:
 * driver-scoped rules only match that driver id; global rules match everyone.
 */
export function matchingLegRules(input: {
  driverId?: string | null;
  operation?: OperationType;
  from?: WageEndpoint;
  to?: WageEndpoint;
  rules: WagePriceRule[];
}): WagePriceRule[] {
  return input.rules
    .filter(rule => rule.unit === "LEG")
    .filter(rule => rule.driver_id === null || rule.driver_id === input.driverId)
    .filter(rule => rule.operation === null || rule.operation === input.operation)
    .filter(rule => locationsMatch(input.from ?? null, input.to ?? null, rule))
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
 * Full per-trip wage against a rule version:
 * 1. the most specific matching LEG rule wins outright - its amount is the
 *    final price (owner column when negotiated, otherwise driver price x
 *    owner multiplier); neither multiplier stacks on a rule price;
 * 2. otherwise the mileage tier table x (OWNER ? owner_multiplier : 1) x
 *    (BOBTAIL ? bobtail_multiplier : 1), rounded to cents.
 * An unpicked driverType/operation counts as DRIVER / full price.
 */
export function calcTripWage(input: {
  driverId?: string | null;
  driverType?: DriverType;
  operation?: OperationType;
  miles: number;
  from?: WageEndpoint;
  to?: WageEndpoint;
  rule: WageRuleData;
}): number {
  const legRule = matchingLegRules({ ...input, rules: input.rule.price_rules })[0];
  if (legRule) {
    const amount =
      input.driverType === "OWNER"
        ? (legRule.owner_amount ?? legRule.driver_amount * input.rule.owner_multiplier)
        : legRule.driver_amount;
    return roundCents(amount);
  }
  const tier = mileageTierWage(input.miles, input.rule.tiers, input.rule.overage_increment);
  const ownerX = input.driverType === "OWNER" ? input.rule.owner_multiplier : 1;
  const bobtailX = input.operation === "BOBTAIL" ? input.rule.bobtail_multiplier : 1;
  return roundCents(tier * ownerX * bobtailX);
}
