import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      displayName: string;
      roles: string[];
    } & DefaultSession["user"];
  }

  interface User {
    roles?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    roles?: string[];
  }
}

// v5 beta: next-auth/jwt re-exports the interface from @auth/core/jwt,
// so the augmentation must target the source module too
declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    roles?: string[];
  }
}
