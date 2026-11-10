import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env");
}

const prisma = new PrismaClient();

const permissionCodes = [
  "driver.read", "driver.write",
  "location.read", "location.write",
  "payroll.read", "payroll.write",
  "report.read"
] as const;

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
    ["VIEWER", "查看者"]
  ];
  for (const [code, name] of roles) {
    await prisma.$executeRaw`
      INSERT INTO common.roles(code, name, is_system)
      VALUES (${code}, ${name}, true)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    `;
  }

  for (const code of permissionCodes) {
    await prisma.$executeRaw`
      INSERT INTO common.permissions(code, name, module, resource, action)
      VALUES (
        ${code}, ${code},
        split_part(${code}, '.', 1),
        split_part(${code}, '.', 2),
        split_part(${code}, '.', 3)
      )
      ON CONFLICT (code) DO NOTHING
    `;
  }

  const rolePermissions: Array<[string, RegExp]> = [
    ["SUPER_ADMIN", /.*/],
    ["FINANCE_CLERK", /^(driver|location|payroll|report)\./],
    ["PAYROLL_REVIEWER", /^(driver|location|payroll|report)\./],
    ["VIEWER", /\.(read)$/]
  ];
  for (const [roleCode, pattern] of rolePermissions) {
    for (const code of permissionCodes.filter(code => pattern.test(code))) {
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
