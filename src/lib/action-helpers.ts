import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import type { PermissionCode } from "@/lib/permission-catalog";
import { withFlash } from "@/lib/search-params";

/** Trimmed string read from a form field ("" when absent) */
export function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** Strict YYYY-MM-DD that also round-trips through Date */
export function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toString() !== "Invalid Date";
}

/**
 * Postgres unique-violation marker. Raw SQL failures surface as
 * PrismaClientKnownRequestError P2010 whose meta.message carries the PG
 * diagnostic (23505 / "duplicate key"); plain text errors also carry it.
 */
export function isDuplicateKey(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { message?: string } | undefined;
    const text = `${error.message} ${meta?.message ?? ""}`;
    return text.includes("23505") || text.includes("duplicate key");
  }
  const message = String((error as { message?: string })?.message ?? "");
  return message.includes("23505") || message.includes("duplicate key");
}

/**
 * Factory for the per-module `backWithError` redirect: reopens the module's
 * edit modal with the error code and the submitted values refilled under
 * `f_<field>` keys. `extraPrefixes` carries checkbox families (e.g. role_/perm_)
 * along; `reopenNewWhenNoId` reopens the "new" modal instead of a bare list
 * view when no id is in play.
 */
export function makeBackWithError(options: {
  basePath: string;
  fields: readonly string[];
  extraPrefixes?: readonly string[];
  reopenNewWhenNoId?: boolean;
}): (error: string, formData: FormData) => never {
  const { basePath, fields, extraPrefixes, reopenNewWhenNoId } = options;
  return (error: string, formData: FormData): never => {
    const params = new URLSearchParams();
    const id = str(formData, "id");
    if (id) params.set("edit", id);
    else if (reopenNewWhenNoId) params.set("new", "1");
    params.set("error", error);
    for (const field of fields) {
      const value = str(formData, field);
      if (value) params.set(`f_${field}`, value);
    }
    for (const prefix of extraPrefixes ?? []) {
      for (const [key, value] of formData.entries()) {
        if (key.startsWith(prefix) && value === "1") params.set(key, "1");
      }
    }
    redirect(`${basePath}?${params.toString()}`);
  };
}

/** Unique-code pre-check shared by the dictionary modules (LIMIT 1 existence) */
export async function codeTaken(options: {
  table: Prisma.Sql;
  column: Prisma.Sql;
  value: string;
  excludeId?: string;
}): Promise<boolean> {
  const rows = options.excludeId
    ? await prisma.$queryRaw<{ one: number }[]>`
        SELECT 1 AS one FROM ${options.table}
        WHERE ${options.column} = ${options.value}
          AND id <> ${options.excludeId}::bigint
        LIMIT 1
      `
    : await prisma.$queryRaw<{ one: number }[]>`
        SELECT 1 AS one FROM ${options.table}
        WHERE ${options.column} = ${options.value}
        LIMIT 1
      `;
  return rows.length > 0;
}

/**
 * Shared ACTIVE/INACTIVE toggle: validate, UPDATE status, revalidate, flash.
 * `validate` lets a module refuse a row before the UPDATE (returning an error
 * code reopens the edit modal). An optional `return_to` filter string rides
 * along for modules whose table rows embed it (drivers/trucks).
 */
export async function setRecordStatus(
  formData: FormData,
  options: {
    permission: PermissionCode;
    table: Prisma.Sql;
    basePath: string;
    revalidatePaths?: readonly string[];
    validate?: (id: string) => Promise<{ error: string } | null>;
  }
): Promise<void> {
  await requirePermission(options.permission);

  const id = str(formData, "id");
  const status = str(formData, "status");
  const returnTo = str(formData, "return_to");

  if (!id || (status !== "ACTIVE" && status !== "INACTIVE")) {
    redirect(returnTo ? `${options.basePath}?${returnTo}` : options.basePath);
  }

  if (options.validate) {
    const failure = await options.validate(id);
    if (failure) {
      const params = new URLSearchParams({ error: failure.error, edit: id });
      redirect(`${options.basePath}?${params.toString()}`);
    }
  }

  await prisma.$executeRaw`
    UPDATE ${options.table}
    SET status = ${status}::common.record_status, updated_at = now()
    WHERE id = ${id}::bigint
  `;

  revalidatePath(options.basePath);
  for (const path of options.revalidatePaths ?? []) revalidatePath(path);
  redirect(withFlash(options.basePath, returnTo, "saved", "status"));
}
