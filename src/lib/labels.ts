export type DriverType = "DRIVER" | "OWNER";
export type RecordStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type LocationType = "BASE" | "AMAZON" | "OTHER";
/** Operation codes live in the ops.operation_types dictionary (managed on
 *  /dashboard/operations); this alias keeps consumer signatures readable. */
export type OperationType = string;

export const DRIVER_TYPE_LABELS: Record<DriverType, string> = {
  DRIVER: "司机",
  OWNER: "车主"
};

/** Whitelist for validating URL/form values before casting to DriverType */
export const DRIVER_TYPES = Object.keys(DRIVER_TYPE_LABELS) as DriverType[];

/** Advisory pricing mode stored on ops.drivers.pricing_mode (entry-sheet default) */
export type PricingMode = "LEG" | "DAY" | "ROUND_TRIP";

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  LEG: "按趟计价",
  DAY: "按天打包",
  ROUND_TRIP: "按往返打包"
};

/** Whitelist for validating URL/form values before casting to PricingMode */
export const PRICING_MODES = Object.keys(PRICING_MODE_LABELS) as PricingMode[];

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  BASE: "基地",
  AMAZON: "亚马逊仓",
  OTHER: "其他"
};

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  ACTIVE: "启用",
  INACTIVE: "停用",
  ARCHIVED: "归档"
};

/** REVIEWED is a legacy DB enum value unused by the app; DONE = driver confirmed (reuse of the idle enum slot) */
export type StatementStatus = "DRAFT" | "VERIFIED" | "DONE";

export const STATEMENT_STATUS_LABELS: Record<StatementStatus, string> = {
  DRAFT: "草稿",
  VERIFIED: "核对",
  DONE: "司机确认"
};

/** DRAFT numbers track the live trips; VERIFIED freezes them (one-way), DONE marks the driver's sign-off */
export const STATEMENT_STATUS_FLOW: readonly StatementStatus[] = [
  "DRAFT",
  "VERIFIED",
  "DONE"
];
