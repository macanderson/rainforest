/**
 * Authenticated route group — every page under (app) renders inside the
 * enterprise shell (docs/architecture.md §2.4) and behind the server-side
 * session guard (issue #27): unauthenticated requests redirect to /login
 * before any page code runs.
 */
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
