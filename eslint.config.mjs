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
  ]),
]);
