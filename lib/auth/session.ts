/**
 * iron-session wiring (architecture.md §5 — "Auth / sessions: iron-session,
 * credential (email + password) auth, three roles").
 *
 * The session is an encrypted, tamper-proof cookie (iron-session sealed
 * data): the server keeps no session store, and the cookie carries only the
 * authenticated user's id, email, display name, and role. The seal password
 * comes from `SESSION_SECRET` (≥32 chars); a deterministic dev fallback keeps
 * local development zero-config but refuses to run in production.
 */
import {
  getIronSession,
  type IronSession,
  type SessionOptions,
} from "iron-session";
import { cookies } from "next/headers";

import { SESSION_ROLES, type SessionRole } from "@/lib/db/session";

export const SESSION_COOKIE_NAME = "rainforest_session";

export interface SessionData {
  user?: {
    id: number;
    email: string;
    displayName: string;
    role: SessionRole;
  };
}

const DEV_FALLBACK_SECRET =
  "rainforest-dev-only-session-secret-do-not-use-in-prod";

export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters in production " +
        "(architecture.md §5 — iron-session seal password)",
    );
  }
  return DEV_FALLBACK_SECRET;
}

export function sessionOptions(): SessionOptions {
  return {
    cookieName: SESSION_COOKIE_NAME,
    password: sessionSecret(),
    ttl: 60 * 60 * 8, // one workday
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  };
}

/** The current request's session (App Router cookie store). */
export async function getSession(): Promise<IronSession<SessionData>> {
  const jar = await cookies();
  return getIronSession<SessionData>(jar, sessionOptions());
}

/** The authenticated user, or null when the request is unauthenticated. */
export async function currentUser(): Promise<SessionData["user"] | null> {
  const session = await getSession();
  const user = session.user;
  if (!user || !SESSION_ROLES.includes(user.role)) return null;
  return user;
}
