import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noOffPaletteColors from "./eslint-rules/no-off-palette-colors.mjs";

const palettePlugin = {
  rules: {
    "no-off-palette-colors": noOffPaletteColors,
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { palette: palettePlugin },
    rules: {
      "palette/no-off-palette-colors": "error",
    },
  },
  {
    // The token sheet itself and the rule that enforces it must be able to
    // name the locked hex values.
    files: ["lib/tokens.ts", "app/globals.css", "eslint-rules/**", "tests/**"],
    rules: {
      "palette/no-off-palette-colors": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "next-env.d.ts",
    "**/*.css",
    // The autonomous builder copies the whole repo — build output and all —
    // into a scratch directory per issue. Git ignores it; without this, a
    // local lint walks those copies and reports thousands of phantom problems
    // in generated chunks. CI never sees them because it checks out fresh.
    ".stella/**",
    // Same reasoning for git worktrees cut inside the repo: they are copies of
    // this tree, and their fixtures (deliberately off-palette colors, for one)
    // are not this checkout's code to judge.
    ".worktrees/**",
  ]),
]);
