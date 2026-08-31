import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "../eslint-rules/no-off-palette-colors.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("palette/no-off-palette-colors", () => {
  it("accepts the locked sheet and rejects everything else", () => {
    ruleTester.run("no-off-palette-colors", rule, {
      valid: [
        // Locked hex literals
        { code: 'const a = "#000000";' },
        { code: 'const a = "#ffffff";' },
        { code: 'const a = "#7f1d1d";' },
        { code: 'const a = "#FCA5A5";' },
        { code: 'const a = "#111827";' },
        { code: 'const a = "#f9fafb";' },
        // Locked shorthand
        { code: 'const a = "#000";' },
        { code: 'const a = "#fff";' },
        // Locked Tailwind classes, incl. variants and opacity modifiers
        { code: 'const c = "bg-black text-white border-grey-200";' },
        { code: 'const c = "bg-red-600 hover:bg-red-700 text-red-400";' },
        { code: 'const c = "bg-grey-50 text-grey-600 ring-grey-300";' },
        { code: 'const c = "md:bg-black/80 fill-red-500 stroke-grey-400";' },
        // Non-color utilities are untouched
        { code: 'const c = "flex min-h-screen rounded-lg px-4 py-2 text-sm";' },
        { code: 'const n = 42;' },
      ],
      invalid: [
        // Off-sheet hex literals
        {
          code: 'const a = "#3b82f6";',
          errors: [{ messageId: "offPaletteHex" }],
        },
        {
          code: 'const a = "#00ff00";',
          errors: [{ messageId: "offPaletteHex" }],
        },
        {
          code: 'const a = "#123456";',
          errors: [{ messageId: "offPaletteHex" }],
        },
        // Default-palette Tailwind classes
        {
          code: 'const c = "bg-blue-500";',
          errors: [{ messageId: "offPaletteClass" }],
        },
        {
          code: 'const c = "text-emerald-100 hover:bg-slate-800";',
          errors: [{ messageId: "offPaletteClass" }],
        },
        // Off-sheet shades of allowed hues
        {
          code: 'const c = "bg-red-100";',
          errors: [{ messageId: "offPaletteClass" }],
        },
        {
          code: 'const c = "text-red-950";',
          errors: [{ messageId: "offPaletteClass" }],
        },
        {
          code: 'const c = "bg-gray-500";',
          errors: [{ messageId: "offPaletteClass" }],
        },
        {
          code: 'const c = "bg-grey-950";',
          errors: [{ messageId: "offPaletteClass" }],
        },
        // CSS color functions
        {
          code: 'const a = "rgb(59, 130, 246)";',
          errors: [{ messageId: "offPaletteFunction" }],
        },
        {
          code: 'const a = "hsl(0 100% 50%)";',
          errors: [{ messageId: "offPaletteFunction" }],
        },
        // JSX usage
        {
          code: 'const el = <div className="bg-amber-400" />;',
          errors: [{ messageId: "offPaletteClass" }],
        },
        {
          code: 'const el = <div style={{ color: "#ff00ff" }} />;',
          errors: [{ messageId: "offPaletteHex" }],
        },
        // Template literals
        {
          code: "const c = `bg-violet-600`;",
          errors: [{ messageId: "offPaletteClass" }],
        },
      ],
    });
  });
});
