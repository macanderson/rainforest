/**
 * Role-aware navigation (architecture.md §5, issue #27).
 *
 * The nav registry is the single source of truth for which role may see
 * which surface. The sidebar renders `navForRole(role)`; the server-side
 * route guard (`requireRole`) uses `roleCanAccess` so protection is enforced
 * on the server, not merely by hiding links.
 */
import type { SessionRole } from "@/lib/db/session";

export interface NavEntry {
  href: string;
  label: string;
  /** Roles permitted to see and access this surface. */
  roles: readonly SessionRole[];
}

const ALL_ROLES: readonly SessionRole[] = ["admin", "sales-rep", "agent"];

/**
 * The shell's nav entries, in sidebar order. Only surfaces that exist today
 * are listed; later epics add their screens here with their permitted roles.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { href: "/", label: "Overview", roles: ALL_ROLES },
  { href: "/jobs", label: "Jobs", roles: ["admin"] },
];

/** The nav entries a role is permitted to see. */
export function navForRole(role: SessionRole): NavEntry[] {
  return NAV_ENTRIES.filter((entry) => entry.roles.includes(role));
}

/** Server-side access check: may `role` access the route at `pathname`? */
export function roleCanAccess(role: SessionRole, pathname: string): boolean {
  // Most specific match wins so nested routes inherit their parent's gate.
  const match = [...NAV_ENTRIES]
    .sort((a, b) => b.href.length - a.href.length)
    .find((entry) =>
      entry.href === "/"
        ? pathname === "/"
        : pathname === entry.href || pathname.startsWith(`${entry.href}/`),
    );
  // Routes outside the nav registry are authenticated-only by default.
  if (!match) return true;
  return match.roles.includes(role);
}
