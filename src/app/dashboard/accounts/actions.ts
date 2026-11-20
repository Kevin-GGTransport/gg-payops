"use server";

import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { withFlash } from "@/lib/search-params";

const FIELDS = ["email", "display_name", "phone", "linked_driver_id"] as const;

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function backWithError(error: string, formData: FormData): never {
  const params = new URLSearchParams();
  const id = str(formData, "id");
  if (id) params.set("edit", id);
  params.set("error", error);
  for (const field of FIELDS) {
    const value = str(formData, field);
    if (value) params.set(`f_${field}`, value);
  }
  // Role checkboxes ride along under their own role_<id> keys
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("role_") && value === "1") params.set(key, "1");
  }
  redirect(`/dashboard/accounts?${params.toString()}`);
}

/** Login lowercases whatever is typed; store it the same way */
function normalizedEmail(formData: FormData) {
  return str(formData, "email").toLowerCase();
}

/** Whitelist the submitted role ids against the roles table */
async function validRoleIds(formData: FormData): Promise<Set<string>> {
  const submitted = new Set(
    [...formData.entries()]
      .filter(([key, value]) => key.startsWith("role_") && value === "1")
      .map(([key]) => key.slice("role_".length))
      .filter(id => /^\d+$/.test(id))
  );
  if (submitted.size === 0) return submitted;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text FROM common.roles
    WHERE id IN (${Prisma.join([...submitted].map(id => Prisma.sql`${id}::bigint`))})
  `;
  return new Set(rows.map(r => r.id));
}

/**
 * Postgres unique-violation marker. Raw SQL failures surface as
 * PrismaClientKnownRequestError P2010 whose meta.message carries the PG
 * diagnostic (23505 / "duplicate key"); plain text errors also carry it.
 */
function isDuplicateKey(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { message?: string } | undefined;
    const text = `${error.message} ${meta?.message ?? ""}`;
    return text.includes("23505") || text.includes("duplicate key");
  }
  const message = String((error as { message?: string })?.message ?? "");
  return message.includes("23505") || message.includes("duplicate key");
}

function revalidateAccounts() {
  revalidatePath("/dashboard/accounts");
  revalidatePath("/dashboard/roles");
}

/**
 * Create an account: hash the initial password (bcrypt cost 12, same as the
 * seed), link roles (assigned_by recorded) and optionally bind a driver
 * profile. The driver binding only lands on a free profile - a driver
 * already tied to another account refuses with driver_linked.
 */
export async function createAccount(formData: FormData) {
  const operator = await requirePermission("account.write");

  const email = normalizedEmail(formData);
  const displayName = str(formData, "display_name");
  const phone = str(formData, "phone") || null;
  const password = String(formData.get("initial_password") ?? "");
  const linkedDriverId = str(formData, "linked_driver_id");

  if (!email) backWithError("missing_email", formData);
  if (!displayName) backWithError("missing_name", formData);
  if (password.length < 8) backWithError("short_password", formData);
  const roleIds = await validRoleIds(formData);
  if (roleIds.size === 0) backWithError("no_roles", formData);

  const hash = await bcrypt.hash(password, 12);

  type CreateFail = { code: string };
  type CreateDone = { ok: true };

  try {
    const result: CreateFail | CreateDone = await prisma.$transaction(async tx => {
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO common.users(email, display_name, phone, password_hash)
        VALUES (${email}, ${displayName}, ${phone}, ${hash})
        RETURNING id::text
      `;
      const newId = inserted[0]?.id;
      if (!newId) return { code: "missing_email" };

      await tx.$executeRaw`
        INSERT INTO common.user_roles(user_id, role_id, assigned_at, assigned_by_user_id)
        SELECT ${newId}::bigint, r.id, now(), ${operator.id}::bigint
        FROM common.roles r
        WHERE r.id IN (${Prisma.join([...roleIds].map(id => Prisma.sql`${id}::bigint`))})
      `;

      if (linkedDriverId) {
        const bound = await tx.$executeRaw`
          UPDATE ops.drivers
          SET linked_user_id = ${newId}::bigint, updated_at = now()
          WHERE id = ${linkedDriverId}::bigint AND linked_user_id IS NULL
        `;
        if (bound === 0) return { code: "driver_linked" };
      }
      return { ok: true as const };
    });

    if ("code" in result) backWithError(result.code, formData);
  } catch (error) {
    if (isDuplicateKey(error)) backWithError("dup_account", formData);
    throw error;
  }

  revalidateAccounts();
  redirect(withFlash("/dashboard/accounts", "", "saved"));
}

/**
 * Update an account's identity (email doubles as the login name), roles and
 * driver binding. Guard rails: an admin editing themselves cannot drop their
 * own SUPER_ADMIN stamp (no self-lockout); deactivation has its own action.
 */
export async function updateAccount(formData: FormData) {
  const operator = await requirePermission("account.write");

  const id = str(formData, "id");
  if (!id) redirect("/dashboard/accounts");
  const email = normalizedEmail(formData);
  const displayName = str(formData, "display_name");
  const phone = str(formData, "phone") || null;
  const linkedDriverId = str(formData, "linked_driver_id");

  if (!email) backWithError("missing_email", formData);
  if (!displayName) backWithError("missing_name", formData);
  const roleIds = await validRoleIds(formData);
  if (roleIds.size === 0) backWithError("no_roles", formData);

  // Self-demote guard: SUPER_ADMIN editing their own roles must keep it
  if (id === operator.id) {
    const mine = await prisma.$queryRaw<Array<{ code: string }>>`
      SELECT r.code FROM common.user_roles ur
      JOIN common.roles r ON r.id = ur.role_id
      WHERE ur.user_id = ${id}::bigint AND r.code = 'SUPER_ADMIN'
      LIMIT 1
    `;
    const superRow = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM common.roles WHERE code = 'SUPER_ADMIN' LIMIT 1
    `;
    if (mine.length > 0 && superRow[0] && !roleIds.has(superRow[0].id)) {
      backWithError("self_demote", formData);
    }
  }

  type UpdateFail = { code: string };
  type UpdateDone = { ok: true };

  try {
    const result: UpdateFail | UpdateDone = await prisma.$transaction(async tx => {
      const updated = await tx.$executeRaw`
        UPDATE common.users
        SET email = ${email}, display_name = ${displayName}, phone = ${phone}, updated_at = now()
        WHERE id = ${id}::bigint
      `;
      if (updated === 0) return { code: "missing_account" };

      await tx.$executeRaw`DELETE FROM common.user_roles WHERE user_id = ${id}::bigint`;
      await tx.$executeRaw`
        INSERT INTO common.user_roles(user_id, role_id, assigned_at, assigned_by_user_id)
        SELECT ${id}::bigint, r.id, now(), ${operator.id}::bigint
        FROM common.roles r
        WHERE r.id IN (${Prisma.join([...roleIds].map(rid => Prisma.sql`${rid}::bigint`))})
      `;

      // Driver rebind: free this account's old profile first, then bind the
      // new one only if it is not taken by another account
      await tx.$executeRaw`
        UPDATE ops.drivers SET linked_user_id = NULL, updated_at = now()
        WHERE linked_user_id = ${id}::bigint
      `;
      if (linkedDriverId) {
        const bound = await tx.$executeRaw`
          UPDATE ops.drivers
          SET linked_user_id = ${id}::bigint, updated_at = now()
          WHERE id = ${linkedDriverId}::bigint AND linked_user_id IS NULL
        `;
        if (bound === 0) return { code: "driver_linked" };
      }
      return { ok: true as const };
    });

    if ("code" in result) backWithError(result.code, formData);
  } catch (error) {
    if (isDuplicateKey(error)) backWithError("dup_account", formData);
    throw error;
  }

  revalidateAccounts();
  redirect(withFlash("/dashboard/accounts", "", "saved"));
}

/** Accounts are never deleted - deactivation kicks their permissions to zero */
export async function setAccountStatus(formData: FormData) {
  const operator = await requirePermission("account.write");

  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || (status !== "ACTIVE" && status !== "INACTIVE")) {
    redirect("/dashboard/accounts");
  }
  if (id === operator.id && status === "INACTIVE") {
    redirect(`/dashboard/accounts?edit=${id}&error=self_deactivate`);
  }

  await prisma.$executeRaw`
    UPDATE common.users SET is_active = ${status === "ACTIVE"}, updated_at = now()
    WHERE id = ${id}::bigint
  `;

  revalidateAccounts();
  redirect(withFlash("/dashboard/accounts", "", "saved", "status"));
}

/** Admin-set new password (no email flow exists); same hashing as sign-up */
export async function resetAccountPassword(formData: FormData) {
  await requirePermission("account.write");

  const id = str(formData, "id");
  const password = String(formData.get("new_password") ?? "");
  if (!id) redirect("/dashboard/accounts");
  if (password.length < 8) {
    redirect(`/dashboard/accounts?reset=${id}&error=short_password`);
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.$executeRaw`
    UPDATE common.users SET password_hash = ${hash}, updated_at = now()
    WHERE id = ${id}::bigint
  `;

  revalidateAccounts();
  redirect(withFlash("/dashboard/accounts", "", "saved", "pwd"));
}
