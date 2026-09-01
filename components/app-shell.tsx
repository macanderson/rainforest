/**
 * The enterprise app shell (docs/architecture.md §2.4 — black topbar, dense
 * grey-bordered sidebar, white content plane; red only for alerts/CTAs).
 *
 * Server component: reads the iron-session user, renders the role-aware
 * sidebar (`navForRole`), and mounts the page content into the white plane.
 * Every authenticated route renders through this shell via app/(app)/layout.
 */
import type { ReactNode } from "react";

import { logout } from "@/lib/auth/actions";
import { navForRole } from "@/lib/auth/nav";
import type { AuthenticatedUser } from "@/lib/auth/guard";
import { SidebarNav } from "./sidebar-nav";

const ROLE_LABELS: Record<AuthenticatedUser["role"], string> = {
  admin: "Admin",
  "sales-rep": "Sales rep",
  agent: "Agent",
};

export function AppShell({
  user,
  children,
}: {
  user: AuthenticatedUser;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Black topbar — §2.4 */}
      <header className="flex items-center justify-between bg-black px-4 py-2">
        <span className="text-sm font-semibold tracking-wide text-white">
          RAINFOREST <span className="text-grey-400">/ ops control plane</span>
        </span>
        <div className="flex items-center gap-3">
          <span className="rounded border border-grey-600 px-2 py-0.5 text-xs font-medium text-grey-300">
            {ROLE_LABELS[user.role]}
          </span>
          <span className="text-xs text-grey-400">{user.displayName}</span>
          <form action={logout}>
            <button
              type="submit"
              className="rounded border border-grey-600 px-2 py-0.5 text-xs font-medium text-grey-300 hover:border-grey-400 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Dense grey-bordered sidebar — §2.4. Role-aware: only the entries
            this role permits are rendered. */}
        <aside className="w-52 shrink-0 border-r border-grey-200 bg-white">
          <SidebarNav entries={navForRole(user.role)} />
        </aside>

        {/* White content plane — §2.4 */}
        <main className="flex-1 bg-white p-6">{children}</main>
      </div>
    </div>
  );
}
