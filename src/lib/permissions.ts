import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, requireUser, type SessionUser } from "@/lib/auth";
import type { PermissionCode } from "@/lib/permission-catalog";

/**
 * Permissions are always read fresh from the DB (never trusted from the JWT,
 * which freezes roles at sign-in) so an admin's role edit applies on the very
 * next request without anyone re-logging in. The is_active check kicks a
 * deactivated account's permissions to zero immediately, live JWT or not.
 *
 * Both the permission set and the sidebar's role names come out of ONE
 * roundtrip (two subquery aggregates on the user row) - the DB is remote
 * (Neon), so halving the per-request RBAC latency matters.
 */
const loadRbac = cache(async (): Promise<{ permissions: Set<string>; roleNames: string[] }> => {
  const user = await getCurrentUser();
  if (!user) return { permissions: new Set(), roleNames: [] };
  const rows = await prisma.$queryRaw<
    Array<{ role_names: string[] | null; codes: string[] | null }>
  >`
    SELECT
      (SELECT array_agg(r.name ORDER BY r.code)
       FROM common.user_roles ur
       JOIN common.roles r ON r.id = ur.role_id
       WHERE ur.user_id = u.id) AS role_names,
      (SELECT array_agg(DISTINCT p.code)
       FROM common.user_roles ur2
       JOIN common.role_permissions rp ON rp.role_id = ur2.role_id
       JOIN common.permissions p ON p.id = rp.permission_id
       WHERE ur2.user_id = u.id) AS codes
    FROM common.users u
    WHERE u.id = ${user.id}::bigint AND u.is_active = true
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { permissions: new Set(), roleNames: [] };
  return { permissions: new Set(row.codes ?? []), roleNames: row.role_names ?? [] };
});

export const getUserPermissions = cache(async (): Promise<Set<string>> => {
  return (await loadRbac()).permissions;
});

export async function hasPermission(code: PermissionCode): Promise<boolean> {
  return (await getUserPermissions()).has(code);
}

/**
 * Page / server-action gate: logged in AND holding the permission, otherwise
 * land on the 403 page. Client-side button hiding is convenience only - this
 * is the authority.
 */
export async function requirePermission(code: PermissionCode): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await getUserPermissions()).has(code)) redirect("/dashboard/forbidden");
  return user;
}

/**
 * Route-handler variant: no HTML redirect, a plain 403 JSON like the existing
 * { error: "unauthorized" } convention. Returns null when access is allowed.
 */
export async function forbidApi(code: PermissionCode): Promise<Response | null> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await getUserPermissions()).has(code)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

/** The driver profile linked to this account (ops.drivers.linked_user_id) */
export const getLinkedDriverId = cache(async (): Promise<string | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text FROM ops.drivers
    WHERE linked_user_id = ${user.id}::bigint
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
});

/**
 * Driver-scoped accounts only touch their own rows. For write actions this is
 * the belt-and-suspenders check on top of the list-level filtering.
 */
export async function assertDriverScope(driverId: string): Promise<void> {
  const linked = await getLinkedDriverId();
  if (linked !== null && linked !== driverId) redirect("/dashboard/forbidden");
}

/** Fresh role names for the sidebar footer (JWT roles are a stale snapshot) */
export const getUserRoleNames = cache(async (): Promise<string[]> => {
  return (await loadRbac()).roleNames;
});

type NavTarget = { href: string; permission: PermissionCode };

/** Sidebar order; the first entry the permissions allow becomes the landing */
const NAV_ORDER: readonly NavTarget[] = [
  { href: "/dashboard/payroll", permission: "payroll.read" },
  { href: "/dashboard/trips", permission: "trip.read" },
  { href: "/dashboard/stats", permission: "report.read" },
  { href: "/dashboard/wage-rules", permission: "wage_rule.read" },
  { href: "/dashboard/drivers", permission: "driver.read" },
  { href: "/dashboard/trucks", permission: "truck.read" },
  { href: "/dashboard/locations", permission: "location.read" },
  { href: "/dashboard/operations", permission: "operation.read" },
  { href: "/dashboard/accounts", permission: "account.read" },
  { href: "/dashboard/roles", permission: "role.read" }
];

/**
 * Where an account without trip.write (a driver, say) should land instead of
 * the entry workbench. The forbidden page only requires login, so the
 * fallback can never loop.
 */
export function firstPermittedHref(permissions: ReadonlySet<string>): string {
  for (const target of NAV_ORDER) {
    if (permissions.has(target.permission)) return target.href;
  }
  return "/dashboard/forbidden";
}
