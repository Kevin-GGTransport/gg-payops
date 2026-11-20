-- G&G PayOps
-- 0033: RBAC goes live - expand the permission dictionary (8 -> 20 codes,
--       Chinese names instead of name=code), add the preset DRIVER role, and
--       reconcile the five preset roles' grants to the canonical matrix
--       (finance loses driver/location write - the old seed regex over-granted;
--       reviewers lose driver/location entirely). Custom roles and user_roles
--       are untouched. Idempotent: upserts + guarded self-registration.

BEGIN;

-- 1) Permission dictionary: 20 codes with Chinese names (legacy rows get
--    their name fixed too)
INSERT INTO common.permissions (module, resource, action, code, name, is_system) VALUES
  ('trip',      'trip',      'read',    'trip.read',       '行程查看',       true),
  ('trip',      'trip',      'write',   'trip.write',      '行程录入与编辑', true),
  ('payroll',   'payroll',   'read',    'payroll.read',    '工资单查看',     true),
  ('payroll',   'payroll',   'write',   'payroll.write',   '工资单编辑',     true),
  ('payroll',   'payroll',   'confirm', 'payroll.confirm', '工资单司机确认', true),
  ('driver',    'driver',    'read',    'driver.read',     '司机档案查看',   true),
  ('driver',    'driver',    'write',   'driver.write',    '司机档案编辑',   true),
  ('truck',     'truck',     'read',    'truck.read',      '车辆查看',       true),
  ('truck',     'truck',     'write',   'truck.write',     '车辆编辑',       true),
  ('location',  'location',  'read',    'location.read',   '位置查看',       true),
  ('location',  'location',  'write',   'location.write',  '位置编辑',       true),
  ('operation', 'operation', 'read',    'operation.read',  '操作类型查看',   true),
  ('operation', 'operation', 'write',   'operation.write', '操作类型编辑',   true),
  ('wage_rule', 'wage_rule', 'read',    'wage_rule.read',  '工资规则查看',   true),
  ('wage_rule', 'wage_rule', 'write',   'wage_rule.write', '工资规则编辑',   true),
  ('report',    'report',    'read',    'report.read',     '数据统计查看',   true),
  ('account',   'account',   'read',    'account.read',    '账号管理查看',   true),
  ('account',   'account',   'write',   'account.write',   '账号管理编辑',   true),
  ('role',      'role',      'read',    'role.read',       '角色权限查看',   true),
  ('role',      'role',      'write',   'role.write',      '角色权限编辑',   true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- 2) Preset DRIVER role (accounts linked to a driver profile)
INSERT INTO common.roles (code, name, is_system)
VALUES ('DRIVER', '司机', true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = now();

-- 3) Reconcile the five preset roles to the canonical matrix: drop their
--    grants, re-insert the exact set. Custom roles keep whatever they have.
DELETE FROM common.role_permissions rp
USING common.roles r
WHERE rp.role_id = r.id
  AND r.code IN ('SUPER_ADMIN', 'FINANCE_CLERK', 'PAYROLL_REVIEWER', 'DRIVER', 'VIEWER');

INSERT INTO common.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  -- SUPER_ADMIN: everything
  ('SUPER_ADMIN', 'trip.read'), ('SUPER_ADMIN', 'trip.write'),
  ('SUPER_ADMIN', 'payroll.read'), ('SUPER_ADMIN', 'payroll.write'), ('SUPER_ADMIN', 'payroll.confirm'),
  ('SUPER_ADMIN', 'driver.read'), ('SUPER_ADMIN', 'driver.write'),
  ('SUPER_ADMIN', 'truck.read'), ('SUPER_ADMIN', 'truck.write'),
  ('SUPER_ADMIN', 'location.read'), ('SUPER_ADMIN', 'location.write'),
  ('SUPER_ADMIN', 'operation.read'), ('SUPER_ADMIN', 'operation.write'),
  ('SUPER_ADMIN', 'wage_rule.read'), ('SUPER_ADMIN', 'wage_rule.write'),
  ('SUPER_ADMIN', 'report.read'),
  ('SUPER_ADMIN', 'account.read'), ('SUPER_ADMIN', 'account.write'),
  ('SUPER_ADMIN', 'role.read'), ('SUPER_ADMIN', 'role.write'),
  -- FINANCE_CLERK: entry + payroll editing, master data read-only
  ('FINANCE_CLERK', 'trip.read'), ('FINANCE_CLERK', 'trip.write'),
  ('FINANCE_CLERK', 'payroll.read'), ('FINANCE_CLERK', 'payroll.write'),
  ('FINANCE_CLERK', 'driver.read'), ('FINANCE_CLERK', 'truck.read'),
  ('FINANCE_CLERK', 'location.read'), ('FINANCE_CLERK', 'operation.read'),
  ('FINANCE_CLERK', 'wage_rule.read'), ('FINANCE_CLERK', 'report.read'),
  -- PAYROLL_REVIEWER: check/confirm payroll, no entry or master data
  ('PAYROLL_REVIEWER', 'trip.read'),
  ('PAYROLL_REVIEWER', 'payroll.read'), ('PAYROLL_REVIEWER', 'payroll.write'), ('PAYROLL_REVIEWER', 'payroll.confirm'),
  ('PAYROLL_REVIEWER', 'report.read'),
  -- DRIVER: own trips + own statements + own confirmation (scope is enforced
  -- in app code via ops.drivers.linked_user_id)
  ('DRIVER', 'trip.read'),
  ('DRIVER', 'payroll.read'), ('DRIVER', 'payroll.confirm'),
  -- VIEWER: read-only across the board
  ('VIEWER', 'trip.read'), ('VIEWER', 'payroll.read'),
  ('VIEWER', 'driver.read'), ('VIEWER', 'truck.read'),
  ('VIEWER', 'location.read'), ('VIEWER', 'operation.read'),
  ('VIEWER', 'wage_rule.read'), ('VIEWER', 'report.read')
) AS g(role_code, perm_code)
JOIN common.roles r ON r.code = g.role_code
JOIN common.permissions p ON p.code = g.perm_code
ON CONFLICT DO NOTHING;

INSERT INTO common._migrations (name)
SELECT '0033_accounts_rbac'
WHERE NOT EXISTS (
  SELECT 1 FROM common._migrations WHERE name = '0033_accounts_rbac'
);

COMMIT;
