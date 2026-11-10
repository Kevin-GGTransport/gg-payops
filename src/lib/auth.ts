import "server-only";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";

export type SessionUser = {
  id: string;
  displayName: string;
  email: string;
  roles: string[];
};

type DbUser = {
  id: string;
  display_name: string;
  email: string;
  password_hash: string;
  roles: string[] | null;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      credentials: {
        email: { label: "用户名 / 邮箱" },
        password: { label: "密码", type: "password" }
      },
      authorize: async raw => {
        const email = String(raw?.email ?? "").trim().toLowerCase();
        const password = String(raw?.password ?? "");
        if (!email || !password) return null;

        const rows = await prisma.$queryRaw<DbUser[]>`
          SELECT u.id::text, u.display_name, u.email, u.password_hash,
                 array_agg(r.code ORDER BY r.code) AS roles
          FROM common.users u
          LEFT JOIN common.user_roles ur ON ur.user_id = u.id
          LEFT JOIN common.roles r ON r.id = ur.role_id
          WHERE u.email_lower = ${email} AND u.is_active = true
          GROUP BY u.id, u.display_name, u.email, u.password_hash
          LIMIT 1
        `;
        const user = rows[0];
        if (!user) return null;
        if (!(await bcrypt.compare(password, user.password_hash))) return null;

        await prisma.$executeRaw`
          UPDATE common.users SET last_login_at = now(), updated_at = now()
          WHERE id = ${user.id}::bigint
        `;

        return { id: user.id, name: user.display_name, email: user.email, roles: user.roles ?? [] };
      }
    })
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.roles = user.roles ?? [];
      }
      return token;
    },
    session({ session, token }) {
      // JWT augmentation doesn't merge reliably in this beta; narrow explicitly
      const claims = token as { id?: string; roles?: string[] };
      if (session.user) {
        session.user.id = claims.id ?? "";
        session.user.roles = claims.roles ?? [];
        session.user.displayName = token.name ?? session.user.email ?? "";
      }
      return session;
    }
  }
});

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    displayName: session.user.displayName ?? session.user.email ?? "",
    email: session.user.email ?? "",
    roles: session.user.roles ?? []
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}
