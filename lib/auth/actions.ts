"use server";

/**
 * Credential login/logout server actions (architecture.md §5, issue #27).
 *
 * Login verifies email + password against the `users` table (scrypt hash),
 * then seals the user into the iron-session cookie. Every failure path —
 * unknown email, bad password, malformed input — returns the same generic
 * error so the form leaks nothing about which accounts exist.
 */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { createDatabase } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "./password";
import { getSession } from "./session";

export interface LoginState {
  error?: string;
}

const GENERIC_ERROR = "Invalid email or password.";

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: GENERIC_ERROR };

  const db = createDatabase();
  let user;
  try {
    user = db.select().from(users).where(eq(users.email, email)).get();
  } finally {
    db.$client.close();
  }
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: GENERIC_ERROR };
  }

  const session = await getSession();
  session.user = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
  await session.save();
  redirect("/");
}

export async function logout(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
