"use client";

import { Switch } from "@base-ui-components/react/switch";
import { useState } from "react";

/**
 * Smoke-test component proving @base-ui-components/react is wired in.
 * Styled exclusively with the locked token sheet.
 */
export function AgentLoopSwitch() {
  const [enabled, setEnabled] = useState(true);

  return (
    <div className="flex items-center gap-3">
      <Switch.Root
        checked={enabled}
        onCheckedChange={setEnabled}
        className="relative flex h-6 w-11 items-center rounded-full border border-grey-300 bg-grey-200 transition-colors data-[checked]:border-red-700 data-[checked]:bg-red-600"
      >
        <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[checked]:translate-x-[1.375rem]" />
      </Switch.Root>
      <span className="text-sm text-grey-700">
        Agent automation loop{" "}
        <span className={enabled ? "font-semibold text-red-600" : "text-grey-500"}>
          {enabled ? "live" : "paused"}
        </span>
      </span>
    </div>
  );
}
