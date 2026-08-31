import { AgentLoopSwitch } from "@/components/agent-loop-switch";

/**
 * Scaffold home page — the §2.4 layout idiom in miniature:
 * black topbar, grey-bordered chrome, white content plane, red only as accent.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-black px-6 py-3">
        <span className="text-sm font-semibold tracking-wide text-white">
          RAINFOREST <span className="text-grey-400">/ ops control plane</span>
        </span>
        <span className="rounded border border-red-600 px-2 py-0.5 text-xs font-medium text-red-400">
          scaffold
        </span>
      </header>

      <div className="flex flex-1">
        <aside className="w-56 border-r border-grey-200 bg-grey-50 p-4">
          <nav className="space-y-1 text-sm">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-grey-500">
              Operations
            </p>
            {["Overview", "Orders", "Inventory", "Suppliers", "Agents"].map(
              (item) => (
                <a
                  key={item}
                  href="#"
                  className="block rounded px-2 py-1.5 text-grey-700 hover:bg-grey-100 hover:text-black"
                >
                  {item}
                </a>
              ),
            )}
          </nav>
        </aside>

        <main className="flex-1 bg-white p-6">
          <h1 className="text-xl font-semibold text-black">
            Ops control plane — scaffold
          </h1>
          <p className="mt-1 max-w-prose text-sm text-grey-600">
            Next.js 16 (App Router, Turbopack) with Base UI and the locked
            black/white/red token sheet. Red appears only where the eye must
            go.
          </p>

          <div className="mt-6 rounded-lg border border-grey-200 p-4">
            <AgentLoopSwitch />
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-lg border border-grey-200 bg-grey-50 p-4 text-sm">
            <span className="inline-block h-2 w-2 rounded-full bg-red-600" />
            <span className="text-grey-700">
              3 shipments past SLA — red is an accent, never a wash.
            </span>
            <a
              href="#"
              className="ml-auto rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
            >
              Review
            </a>
          </div>
        </main>
      </div>
    </div>
  );
}
