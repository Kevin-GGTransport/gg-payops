import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config, shared by src/proxy.ts (route protection) and the
 * full setup in src/lib/auth.ts. Node-only providers (Prisma, bcrypt) are
 * added there, never here.
 */
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  providers: [],
  callbacks: {
    /** /dashboard/* requires a session; the proxy redirects to /sign-in otherwise */
    authorized({ auth, request }) {
      const onDashboard = request.nextUrl.pathname.startsWith("/dashboard");
      return !onDashboard || Boolean(auth?.user);
    }
  }
} satisfies NextAuthConfig;
