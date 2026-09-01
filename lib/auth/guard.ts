/**
 * Server-side route protection (issue #27 — "Route protection enforced
 * server-side, not just hidden nav links").
 *
 * Every authenticated page calls `requireUser` (or `requireRole`) at the top
 * of its server component. Unauthenticated requests redirect to /login;
 * authenticated requests whose role may not access the route get a 404 (the
 * surface does not exist for them — no information leaks about what exists).
 */
import { notFound, redirect } from "next/navigation";

import { currentUser, type SessionData } from "./session";
import { roleCanAccess } from "./nav";
import type { SessionRole } from "@/lib/db/session";

export type AuthenticatedUser = NonNullable<SessionData["user"]>;

/** The authenticated user, redirecting unauthenticated requests to /login. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The authenticated user, but only when their role may access `pathname`;
 * otherwise a 404. Pages under a nav-gated route call this with their path.
 */
export async function requireRole(pathname: string): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!roleCanAccess(user.role, pathname)) notFound();
  return user;
}

/** Convenience: assert the user's role is one of `roles`, else 404. */
export async function requireOneOf(
  roles: readonly SessionRole[],
): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) notFound();
  return user;
}
