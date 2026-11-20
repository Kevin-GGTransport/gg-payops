import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env");
}

const prisma = new PrismaClient();

/** [code, Chinese name] - must stay in lockstep with migration 0033 */
const permissionCodes: Array<[string, string]> = [
  ["trip.read", "行程查看"],
  ["trip.write", "行程录入与编辑"],
  ["payroll.read", "工资单查看"],
  ["payroll.write", "工资单编辑"],
  ["payroll.confirm", "工资单司机确认"],
  ["driver.read", "司机档案查看"],
  ["driver.write", "司机档案编辑"],
  ["truck.read", "车辆查看"],
  ["truck.write", "车辆编辑"],
  ["location.read", "位置查看"],
  ["location.write", "位置编辑"],
  ["operation.read", "操作类型查看"],
  ["operation.write", "操作类型编辑"],
  ["wage_rule.read", "工资规则查看"],
  ["wage_rule.write", "工资规则编辑"],
  ["report.read", "数据统计查看"],
  ["account.read", "账号管理查看"],
  ["account.write", "账号管理编辑"],
  ["role.read", "角色权限查看"],
  ["role.write", "角色权限编辑"]
];

/**
 * Explicit preset-role grant matrix (the old RegExp scheme over-granted:
 * finance got master-data writes it never uses). Keep aligned with 0033.
 */
const roleGrants: Record<string, string[]> = {
  SUPER_ADMIN: permissionCodes.map(([code]) => code),
  FINANCE_CLERK: [
    "trip.read", "trip.write", "payroll.read", "payroll.write",
    "driver.read", "truck.read", "location.read", "operation.read",
    "wage_rule.read", "report.read"
  ],
  PAYROLL_REVIEWER: [
    "trip.read", "payroll.read", "payroll.write", "payroll.confirm", "report.read"
  ],
  DRIVER: ["trip.read", "payroll.read", "payroll.confirm"],
  VIEWER: [
    "trip.read", "payroll.read", "driver.read", "truck.read",
    "location.read", "operation.read", "wage_rule.read", "report.read"
  ]
};

async function main() {
  const [adminHash, financeHash, reviewerHash] = await Promise.all([
    bcrypt.hash("admin123", 12),
    bcrypt.hash("Finance123456", 12),
    bcrypt.hash("Reviewer123456", 12)
  ]);

  // 兼容旧库：把历史 admin@gg.local 账号改为用户名 admin
  await prisma.$executeRaw`
    UPDATE common.users
    SET email = 'admin', password_hash = ${adminHash}, updated_at = now()
    WHERE email_lower = 'admin@gg.local'
  `;

  const users: Array<[string, string, string]> = [
    ["admin", "系统管理员", adminHash],
    ["finance@gg.local", "林财务", financeHash],
    ["reviewer@gg.local", "张审核", reviewerHash]
  ];
  for (const [email, name, hash] of users) {
    await prisma.$executeRaw`
      INSERT INTO common.users(email, display_name, password_hash)
      VALUES (${email}, ${name}, ${hash})
      ON CONFLICT (email_lower) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        password_hash = EXCLUDED.password_hash,
        is_active = true,
        updated_at = now()
    `;
  }

  const roles: Array<[string, string]> = [
    ["SUPER_ADMIN", "超级管理员"],
    ["FINANCE_CLERK", "财务录入员"],
    ["PAYROLL_REVIEWER", "工资审核人"],
    ["DRIVER", "司机"],
    ["VIEWER", "查看者"]
  ];
  for (const [code, name] of roles) {
    await prisma.$executeRaw`
      INSERT INTO common.roles(code, name, is_system)
      VALUES (${code}, ${name}, true)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    `;
  }

  for (const [code, name] of permissionCodes) {
    await prisma.$executeRaw`
      INSERT INTO common.permissions(code, name, module, resource, action)
      VALUES (
        ${code}, ${name},
        split_part(${code}, '.', 1),
        split_part(${code}, '.', 2),
        split_part(${code}, '.', 3)
      )
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    `;
  }

  for (const [roleCode, codes] of Object.entries(roleGrants)) {
    for (const code of codes) {
      await prisma.$executeRaw`
        INSERT INTO common.role_permissions(role_id, permission_id)
        SELECT r.id, p.id FROM common.roles r, common.permissions p
        WHERE r.code = ${roleCode} AND p.code = ${code}
        ON CONFLICT DO NOTHING
      `;
    }
  }

  const userRoles: Array<[string, string]> = [
    ["admin", "SUPER_ADMIN"],
    ["finance@gg.local", "FINANCE_CLERK"],
    ["reviewer@gg.local", "PAYROLL_REVIEWER"]
  ];
  for (const [email, roleCode] of userRoles) {
    await prisma.$executeRaw`
      INSERT INTO common.user_roles(user_id, role_id)
      SELECT u.id, r.id FROM common.users u, common.roles r
      WHERE u.email = ${email} AND r.code = ${roleCode}
      ON CONFLICT DO NOTHING
    `;
  }

  await prisma.$executeRaw`
    INSERT INTO ops.state_codes(code, name) VALUES ('CA', 'California'), ('NV', 'Nevada')
    ON CONFLICT (code) DO NOTHING
  `;

  console.log("Seeded G&G PayOps local database successfully.");
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
