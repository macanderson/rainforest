import { AgentLoopSwitch } from "@/components/agent-loop-switch";

/**
 * Overview — the shell's home surface. The chrome (black topbar, dense
 * role-aware sidebar, white content plane) is rendered by the (app) route
 * group layout; this page is just the content on the white plane. Red
 * remains accent-only per §2.4 / AGENTS.md §4.
 */
export default function HomePage() {
  return (
    <>
      <h1 className="text-xl font-semibold text-black">Ops control plane</h1>
      <p className="mt-1 max-w-prose text-sm text-grey-600">
        The Rainforest fulfillment flywheel, governed: the shell above is
        role-aware (architecture.md §5) and every surface mounts into this
        white content plane.
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
    </>
  );
}
