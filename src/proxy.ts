import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Next 16 middleware: the authorized callback in authConfig guards /dashboard/*
// and redirects anonymous requests to the sign-in page.
export const { auth } = NextAuth(authConfig);

export default auth;

export const config = { matcher: ["/dashboard/:path*"] };
