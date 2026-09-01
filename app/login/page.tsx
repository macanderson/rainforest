/**
 * Login page — credential auth (email + password) per architecture.md §5.
 * Sits outside the app shell: black top brand mark on the white plane, the
 * form in a grey-bordered card, red reserved for the error alert and the
 * submit CTA (§2.4, AGENTS.md §4).
 *
 * Already-authenticated users are sent straight to the shell.
 */
import { redirect } from "next/navigation";

import { login } from "@/lib/auth/actions";
import { currentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — Rainforest" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-black px-4 py-2">
        <span className="text-sm font-semibold tracking-wide text-white">
          RAINFOREST <span className="text-grey-400">/ ops control plane</span>
        </span>
      </header>

      <main className="flex flex-1 items-start justify-center bg-white px-4 pt-24">
        <div className="w-full max-w-sm rounded-lg border border-grey-200 bg-white p-6">
          <h1 className="text-lg font-semibold text-black">Sign in</h1>
          <p className="mt-1 text-sm text-grey-600">
            Credential access for the Rainforest ops control plane
            (architecture.md §5).
          </p>
          <LoginForm action={login} />
        </div>
      </main>
    </div>
  );
}
