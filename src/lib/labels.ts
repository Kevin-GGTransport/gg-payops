export type DriverType = "DRIVER" | "OWNER";
export type RecordStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type LocationType = "BASE" | "AMAZON" | "OTHER";
export type OperationType = "DEL" | "EMPTY" | "BOBTAIL" | "LIVE";

export const DRIVER_TYPE_LABELS: Record<DriverType, string> = {
  DRIVER: "司机",
  OWNER: "车主"
};

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  BASE: "基地",
  AMAZON: "亚马逊仓",
  OTHER: "其他"
};

export const OPERATION_META: Record<OperationType, { label: string; desc: string }> = {
  DEL: { label: "DEL", desc: "卸货 / 送柜" },
  LIVE: { label: "LIVE", desc: "现场装卸" },
  EMPTY: { label: "EMPTY", desc: "带空柜行驶" },
  BOBTAIL: { label: "BOBTAIL", desc: "车头单独行驶" }
};

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  ACTIVE: "启用",
  INACTIVE: "停用",
  ARCHIVED: "归档"
};
