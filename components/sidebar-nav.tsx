"use client";

/**
 * Sidebar navigation — dense, grey-bordered, one entry per permitted surface.
 * Client component so the current path can drive the active state; the
 * entries themselves are computed server-side from the session role (the
 * role-aware filtering never happens in the browser).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavEntry } from "@/lib/auth/nav";

export function SidebarNav({ entries }: { entries: NavEntry[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="py-2">
      <ul className="space-y-px">
        {entries.map((entry) => {
          const active =
            entry.href === "/"
              ? pathname === "/"
              : pathname.startsWith(entry.href);
          return (
            <li key={entry.href}>
              <Link
                href={entry.href}
                aria-current={active ? "page" : undefined}
                className={`block border-l-2 px-4 py-1.5 text-sm ${
                  active
                    ? "border-black bg-grey-100 font-semibold text-black"
                    : "border-white text-grey-700 hover:bg-grey-50 hover:text-black"
                }`}
              >
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
