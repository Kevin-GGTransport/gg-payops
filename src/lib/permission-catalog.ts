/**
 * The permission dictionary shared by server enforcement and the role-editor
 * matrix. Keep in lockstep with migration 0033 / prisma/seed.ts - codes are
 * `resource.action` pairs stored in common.permissions.code.
 */
export const PERMISSION_CODES = [
  "trip.read",
  "trip.write",
  "payroll.read",
  "payroll.write",
  "payroll.confirm",
  "driver.read",
  "driver.write",
  "truck.read",
  "truck.write",
  "location.read",
  "location.write",
  "operation.read",
  "operation.write",
  "wage_rule.read",
  "wage_rule.write",
  "report.read",
  "account.read",
  "account.write",
  "role.read",
  "role.write"
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  "trip.read": "行程查看",
  "trip.write": "行程录入与编辑",
  "payroll.read": "工资单查看",
  "payroll.write": "工资单编辑",
  "payroll.confirm": "工资单司机确认",
  "driver.read": "司机档案查看",
  "driver.write": "司机档案编辑",
  "truck.read": "车辆查看",
  "truck.write": "车辆编辑",
  "location.read": "位置查看",
  "location.write": "位置编辑",
  "operation.read": "操作类型查看",
  "operation.write": "操作类型编辑",
  "wage_rule.read": "工资规则查看",
  "wage_rule.write": "工资规则编辑",
  "report.read": "数据统计查看",
  "account.read": "账号管理查看",
  "account.write": "账号管理编辑",
  "role.read": "角色权限查看",
  "role.write": "角色权限编辑"
};

/** Whitelist for form input: anything outside the catalog is rejected */
export const isPermissionCode = (v: string): v is PermissionCode =>
  (PERMISSION_CODES as readonly string[]).includes(v);

/**
 * Matrix grouping for the role editor: one row per module, that module's
 * permissions laid out horizontally (查看 / 编辑 / 司机确认).
 */
export const PERMISSION_MODULES: ReadonlyArray<{
  module: string;
  label: string;
  permissions: ReadonlyArray<PermissionCode>;
}> = [
  {
    module: "trip",
    label: "行程",
    permissions: ["trip.read", "trip.write"]
  },
  {
    module: "payroll",
    label: "工资单",
    permissions: ["payroll.read", "payroll.write", "payroll.confirm"]
  },
  {
    module: "driver",
    label: "司机",
    permissions: ["driver.read", "driver.write"]
  },
  {
    module: "truck",
    label: "车辆",
    permissions: ["truck.read", "truck.write"]
  },
  {
    module: "location",
    label: "位置",
    permissions: ["location.read", "location.write"]
  },
  {
    module: "operation",
    label: "操作类型",
    permissions: ["operation.read", "operation.write"]
  },
  {
    module: "wage_rule",
    label: "工资规则",
    permissions: ["wage_rule.read", "wage_rule.write"]
  },
  {
    module: "report",
    label: "数据统计",
    permissions: ["report.read"]
  },
  {
    module: "account",
    label: "账号管理",
    permissions: ["account.read", "account.write"]
  },
  {
    module: "role",
    label: "角色权限",
    permissions: ["role.read", "role.write"]
  }
];
