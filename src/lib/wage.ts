import type { DriverType, OperationType } from "@/lib/labels";

/**
 * One trip endpoint for pricing: the picked dictionary location with its
 * class tag. Free-text ends resolve to null - they match no rule and fall to
 * the mileage tiers.
 */
export type WageEndpoint = { id: string; class_tag: string | null } | null;

/** Billing unit of a price rule (pay.wage_rule_prices.unit) */
export type WagePriceUnit = "LEG" | "ROUND_TRIP" | "DAY";

/**
 * One price rule (pay.wage_rule_prices) - the ONLY pricing primitive:
 * 适用司机 (NULL = everyone) x 起点/终点 (each side: a dictionary location,
 * a class tag, or NULL = any; matched as an unordered pair) x 操作 (NULL =
 * any) x unit x driver price x owner price (NULL = driver price x owner
 * multiplier). LEG prices one leg as a final price; ROUND_TRIP / DAY suggest
 * package prices in the entry sheet. Tag sides make rules follow locations:
 * re-tag a location and every tag-keyed rule re-prices instantly.
 */
export type WagePriceRule = {
  id: string;
  driver_id: string | null;
  unit: WagePriceUnit;
  from_location_id: string | null;
  to_location_id: string | null;
  from_tag: string | null;
  to_tag: string | null;
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
  owner_multiplier: number;
  bobtail_multiplier: number;
  overage_increment: number;
  /** Owner fuel subsidy per mile; 0 disables the subsidy line everywhere */
  fuel_subsidy_rate: number;
  tiers: WageTier[];
  price_rules: WagePriceRule[];
};

/** Round to cents so the controlled input and numeric(12,2) stay in sync. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Owner fuel subsidy: miles x the ACTIVE version's rate, for OWNER-type
 * drivers only (price_as_driver owners included - the fuel cost is theirs
 * regardless of pricing identity). Independent of rule matching, packages
 * and multipliers; snapshotted onto the trip at entry/edit time.
 */
export function calcFuelSubsidy(input: {
  driverType?: DriverType | null;
  miles: number;
  rate: number;
}): number {
  if (input.driverType !== "OWNER" || !(input.rate > 0)) return 0;
  return roundCents((Number.isFinite(input.miles) ? input.miles : 0) * input.rate);
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
 * operation-constrained beats open, a pinned location beats a tag beat any.
 * Ties keep insertion order (stable sort).
 */
function ruleSpecificity(rule: WagePriceRule): number {
  const sideScore = (locationId: string | null, tag: string | null) =>
    locationId !== null ? 2 : tag !== null ? 1 : 0;
  return (
    (rule.driver_id !== null ? 8 : 0) +
    (rule.operation !== null ? 4 : 0) +
    sideScore(rule.from_location_id, rule.from_tag) +
    sideScore(rule.to_location_id, rule.to_tag)
  );
}

/** Does one side of a rule (location id or tag, null = any) match an endpoint? */
function sideMatches(
  locationId: string | null,
  tag: string | null,
  endpoint: WageEndpoint
): boolean {
  if (locationId === null && tag === null) return true;
  if (locationId !== null) return endpoint !== null && locationId === endpoint.id;
  return endpoint !== null && tag === endpoint.class_tag;
}

/** Does one endpoint pair satisfy a rule's from/to sides (unordered)? */
function locationsMatch(
  from: WageEndpoint,
  to: WageEndpoint,
  rule: WagePriceRule
): boolean {
  const fromSide = (endpoint: WageEndpoint) =>
    sideMatches(rule.from_location_id, rule.from_tag, endpoint);
  const toSide = (endpoint: WageEndpoint) =>
    sideMatches(rule.to_location_id, rule.to_tag, endpoint);
  return (fromSide(from) && toSide(to)) || (fromSide(to) && toSide(from));
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
 * Full per-trip wage against the single ACTIVE rule version:
 * 1. the most specific matching LEG rule wins outright - its amount is the
 *    final price (owner column when negotiated, otherwise driver price x
 *    owner multiplier); neither multiplier stacks on a rule price;
 * 2. otherwise the mileage tier table x (OWNER ? owner_multiplier : 1) x
 *    (BOBTAIL ? bobtail_multiplier : 1), rounded to cents.
 * priceAsDriver overrides the pricing identity: an owner-type driver flagged
 * as such bills at driver prices everywhere (rule driver column, no owner
 * multiplier). An unpicked driverType/operation counts as DRIVER / full price.
 */
export function calcTripWage(input: {
  driverId?: string | null;
  driverType?: DriverType;
  priceAsDriver?: boolean;
  operation?: OperationType;
  miles: number;
  from?: WageEndpoint;
  to?: WageEndpoint;
  rule: WageRuleData;
}): number {
  const billsAsOwner = input.driverType === "OWNER" && !input.priceAsDriver;
  const legRule = matchingLegRules({ ...input, rules: input.rule.price_rules })[0];
  if (legRule) {
    const amount = billsAsOwner
      ? (legRule.owner_amount ?? legRule.driver_amount * input.rule.owner_multiplier)
      : legRule.driver_amount;
    return roundCents(amount);
  }
  const tier = mileageTierWage(input.miles, input.rule.tiers, input.rule.overage_increment);
  const ownerX = billsAsOwner ? input.rule.owner_multiplier : 1;
  const bobtailX = input.operation === "BOBTAIL" ? input.rule.bobtail_multiplier : 1;
  return roundCents(tier * ownerX * bobtailX);
}
