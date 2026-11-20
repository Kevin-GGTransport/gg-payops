import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DriverType } from "@/lib/labels";

/**
 * One login account as shown on the accounts page. `roles` aggregates the
 * user's role stamps (code + Chinese name); `linked_driver_*` is the driver
 * profile this account is scoped to, if any. password_hash is never selected.
 */
export type AccountRow = {
  id: string;
  email: string;
  display_name: string;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  roles: Array<{ code: string; name: string }>;
  linked_driver_id: string | null;
  linked_driver_name: string | null;
};

export type AccountCounts = { total: number; active: number; inactive: number };

const ACCOUNT_SELECT = Prisma.sql`
  SELECT u.id::text, u.email, u.display_name, u.phone, u.is_active,
         to_char(u.last_login_at, 'YYYY-MM-DD HH24:MI') AS last_login_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name) ORDER BY r.code)
           FROM common.user_roles ur
           JOIN common.roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id
         ), '[]'::jsonb) AS roles,
         d.id::text AS linked_driver_id,
         d.full_name AS linked_driver_name
  FROM common.users u
  LEFT JOIN ops.drivers d ON d.linked_user_id = u.id
`;

/** Account list with the status-tab counts sharing the q scoping */
export async function listAccounts(filter: { q: string; status: "all" | "active" | "inactive" }) {
  const scope = filter.q
    ? Prisma.sql` AND (u.email_lower ILIKE ${`%${filter.q.toLowerCase()}%`} OR u.display_name ILIKE ${`%${filter.q}%`})`
    : Prisma.sql``;
  const statusClause =
    filter.status === "all"
      ? Prisma.sql``
      : Prisma.sql` AND u.is_active = ${filter.status === "active"}`;

  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<AccountRow[]>`
      ${ACCOUNT_SELECT}
      WHERE 1 = 1 ${scope} ${statusClause}
      ORDER BY u.is_active DESC, u.email_lower
    `,
    prisma.$queryRaw<AccountCounts[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE u.is_active)::int AS active,
             count(*) FILTER (WHERE NOT u.is_active)::int AS inactive
      FROM common.users u
      WHERE 1 = 1 ${scope}
    `
  ]);
  return { rows, counts: counts[0] ?? { total: 0, active: 0, inactive: 0 } };
}

export async function getAccountById(id: string) {
  const rows = await prisma.$queryRaw<AccountRow[]>`
    ${ACCOUNT_SELECT} WHERE u.id = ${id}::bigint LIMIT 1
  `;
  return rows[0] ?? null;
}

/** All roles for the editor's checkbox group (system presets first) */
export async function roleOptions() {
  return prisma.$queryRaw<
    Array<{ id: string; code: string; name: string; is_system: boolean }>
  >`
    SELECT id::text, code, name, is_system
    FROM common.roles
    WHERE status = 'ACTIVE'
    ORDER BY is_system DESC, code
  `;
}

/** ACTIVE drivers for the linking picker (a deactivated linked driver is
 *  echoed back via labelForValue on the edit form instead) */
export async function activeDriversForLinking() {
  return prisma.$queryRaw<
    Array<{ id: string; full_name: string; driver_type: DriverType }>
  >`
    SELECT id::text, full_name, driver_type::text AS driver_type
    FROM ops.drivers
    WHERE status = 'ACTIVE'
    ORDER BY full_name
  `;
}
