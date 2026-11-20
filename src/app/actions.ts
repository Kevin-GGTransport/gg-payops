"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { signIn, signOut, requireUser } from "@/lib/auth";

/** Credentials sign-in via form action; NEXT_REDIRECT from success passes through */
export async function authenticate(formData: FormData) {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard"
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(error.type === "CredentialsSignin" ? "/sign-in?error=invalid" : "/sign-in?error=unknown");
    }
    throw error;
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}

/** Why a self-service password change was refused; the dialog maps to Chinese */
export type ChangePasswordErrorCode = "wrong_password" | "short_password" | "mismatch";

/**
 * Self-service password change from the sidebar footer. Login only - no
 * permission needed (every account, drivers included, should be able to
 * rotate the password an admin handed out). The JWT stays valid, so no
 * re-login is forced on the changing session.
 */
export async function changeOwnPassword(
  formData: FormData
): Promise<{ ok: true } | { ok: false; code: ChangePasswordErrorCode }> {
  const user = await requireUser();

  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (newPassword.length < 8) return { ok: false, code: "short_password" };
  if (newPassword !== confirmPassword) return { ok: false, code: "mismatch" };

  const rows = await prisma.$queryRaw<Array<{ password_hash: string }>>`
    SELECT password_hash FROM common.users WHERE id = ${user.id}::bigint LIMIT 1
  `;
  const stored = rows[0]?.password_hash;
  if (!stored || !(await bcrypt.compare(currentPassword, stored))) {
    return { ok: false, code: "wrong_password" };
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.$executeRaw`
    UPDATE common.users SET password_hash = ${hash}, updated_at = now()
    WHERE id = ${user.id}::bigint
  `;
  return { ok: true };
}
