/**
 * The locked black/white/red design-token sheet (docs/architecture.md §2).
 *
 * This module is the single source of truth for the palette. Tailwind's theme
 * (app/globals.css) and the palette lint rule (eslint-rules/no-off-palette-colors)
 * both derive from these exact values. No other hue may appear anywhere in the app.
 */

export const core = {
  black: "#000000",
  white: "#ffffff",
} as const;

/** Accent only — alerts, CTAs, deltas, low-stock flags. Never a surface wash. */
export const red = {
  900: "#7f1d1d",
  800: "#991b1b",
  700: "#b91c1c",
  600: "#dc2626",
  500: "#ef4444",
  400: "#f87171",
  300: "#fca5a5",
} as const;

/** Chrome — borders, secondary text, table zebra, disabled states. */
export const grey = {
  900: "#111827",
  800: "#1f2937",
  700: "#374151",
  600: "#4b5563",
  500: "#6b7280",
  400: "#9ca3af",
  300: "#d1d5db",
  200: "#e5e7eb",
  100: "#f3f4f6",
  50: "#f9fafb",
} as const;

export const tokens = { ...core, red, grey } as const;

/** Every permitted hex literal, lowercase. */
export const allowedHexColors: ReadonlySet<string> = new Set(
  [core.black, core.white, ...Object.values(red), ...Object.values(grey)].map(
    (hex) => hex.toLowerCase(),
  ),
);

/** Every permitted Tailwind color class name (e.g. "red-600", "grey-50", "black"). */
export const allowedColorClassNames: ReadonlySet<string> = new Set([
  "black",
  "white",
  ...Object.keys(red).map((shade) => `red-${shade}`),
  ...Object.keys(grey).map((shade) => `grey-${shade}`),
]);
