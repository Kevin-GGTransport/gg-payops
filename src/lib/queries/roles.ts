import { prisma } from "@/lib/prisma";

/**
 * One role as shown on the roles page: a permission-template row with its
 * grant count and the account count using it. `permissions` holds the
 * permission codes granted to this role (matrix echo-back on the editor).
 */
export type RoleRow = {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  user_count: number;
  permissions: string[];
};

export async function listRoles() {
  return prisma.$queryRaw<RoleRow[]>`
    SELECT r.id::text, r.code, r.name, r.is_system,
           (SELECT count(*)::int FROM common.user_roles ur WHERE ur.role_id = r.id) AS user_count,
           COALESCE((
             SELECT array_agg(p.code ORDER BY p.code)
             FROM common.role_permissions rp
             JOIN common.permissions p ON p.id = rp.permission_id
             WHERE rp.role_id = r.id
           ), '{}') AS permissions
    FROM common.roles r
    WHERE r.status = 'ACTIVE'
    ORDER BY r.is_system DESC, r.code
  `;
}

export async function getRoleById(id: string) {
  const rows = await prisma.$queryRaw<RoleRow[]>`
    SELECT r.id::text, r.code, r.name, r.is_system,
           (SELECT count(*)::int FROM common.user_roles ur WHERE ur.role_id = r.id) AS user_count,
           COALESCE((
             SELECT array_agg(p.code ORDER BY p.code)
             FROM common.role_permissions rp
             JOIN common.permissions p ON p.id = rp.permission_id
             WHERE rp.role_id = r.id
           ), '{}') AS permissions
    FROM common.roles r
    WHERE r.id = ${id}::bigint AND r.status = 'ACTIVE'
    LIMIT 1
  `;
  return rows[0] ?? null;
}
