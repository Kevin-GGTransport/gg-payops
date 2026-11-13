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
