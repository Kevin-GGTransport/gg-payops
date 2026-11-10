"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";

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
