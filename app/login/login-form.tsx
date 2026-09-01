"use client";

/**
 * The credential login form — posts email + password to the login server
 * action and renders the generic error alert (red, the palette's alert
 * channel) on failure. Client component for useActionState; all
 * authentication happens server-side in the action.
 */
import { useActionState } from "react";

import type { LoginState } from "@/lib/auth/actions";

export function LoginForm({
  action,
}: {
  action: (prev: LoginState, formData: FormData) => Promise<LoginState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="mt-4 space-y-3">
      {state.error && (
        <div
          role="alert"
          className="rounded border border-red-600 bg-white px-3 py-2 text-sm font-medium text-red-700"
        >
          {state.error}
        </div>
      )}
      <div>
        <label
          htmlFor="email"
          className="block text-xs font-medium uppercase tracking-wider text-grey-500"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded border border-grey-300 bg-white px-3 py-1.5 text-sm text-black outline-none focus:border-black"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="block text-xs font-medium uppercase tracking-wider text-grey-500"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded border border-grey-300 bg-white px-3 py-1.5 text-sm text-black outline-none focus:border-black"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-grey-300 disabled:text-grey-500"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
