/*
 * Build-output witness for the palette reset in app/globals.css (#56/#57).
 *
 * The lint-rule suite (tests/no-off-palette-colors.test.mjs) only sees source
 * text; it cannot tell whether Tailwind's default palette survives the build.
 * This test builds a fixture page carrying `bg-blue-500` — a default-palette
 * class the lint rule would never let into the repo — and asserts on the
 * emitted CSS: no `.bg-blue-500` rule may exist, while `.bg-black` and
 * `.bg-red-600` must still resolve. It goes red the moment `--color-*: initial`
 * is removed from app/globals.css, and green again when it is restored.
 *
 * It needs a real `next build`, so it lives outside the `node --test
 * tests/*.test.mjs` unit suite and runs via `npm run test:palette-build`.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");

function emittedCss(fixtureDir) {
  const staticDir = join(fixtureDir, ".next", "static");
  const cssFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".css")) cssFiles.push(path);
    }
  };
  walk(staticDir);
  assert.ok(
    cssFiles.length > 0,
    `build produced no CSS under ${staticDir} — did the fixture emit any styles?`,
  );
  return cssFiles.map((file) => readFileSync(file, "utf8")).join("\n");
}

describe("palette reset (build output)", () => {
  let fixtureDir;

  after(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it(
    "strips default-palette utilities while locked tokens still resolve",
    { timeout: 300_000 },
    () => {
      assert.ok(
        existsSync(nextBin),
        "node_modules/next not found — run `npm ci` before `npm run test:palette-build`",
      );

      // The fixture must live under the repo root: Turbopack refuses a
      // node_modules symlink that points outside the project root, so a
      // fixture in os.tmpdir() cannot resolve next/react from this install.
      fixtureDir = mkdtempSync(join(repoRoot, ".palette-fixture-"));
      const appDir = join(fixtureDir, "app");
      mkdirSync(appDir, { recursive: true });

      symlinkSync(
        join(repoRoot, "node_modules"),
        join(fixtureDir, "node_modules"),
        "dir",
      );

      // Keep Tailwind's automatic source detection out of the symlinked tree.
      writeFileSync(join(fixtureDir, ".gitignore"), "node_modules\n.next\n");
      writeFileSync(
        join(fixtureDir, "package.json"),
        JSON.stringify({ private: true, type: "module" }),
      );
      copyFileSync(
        join(repoRoot, "postcss.config.mjs"),
        join(fixtureDir, "postcss.config.mjs"),
      );
      // The file under test: the repo's real theme, reset included (or not).
      copyFileSync(
        join(repoRoot, "app", "globals.css"),
        join(appDir, "globals.css"),
      );

      writeFileSync(
        join(appDir, "layout.jsx"),
        `import "./globals.css";
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      );
      // bg-blue-500 is a default-palette class: it compiles only if the
      // `--color-*: initial` reset is missing. bg-black and bg-red-600 are
      // locked tokens and must always resolve.
      writeFileSync(
        join(appDir, "page.jsx"),
        `export default function Page() {
  return (
    <main className="bg-blue-500">
      <p className="bg-black text-white">locked core</p>
      <p className="bg-red-600">locked accent</p>
    </main>
  );
}
`,
      );

      execFileSync(process.execPath, [nextBin, "build"], {
        cwd: fixtureDir,
        env: { ...process.env, CI: "1", NEXT_TELEMETRY_DISABLED: "1" },
        stdio: "pipe",
        timeout: 300_000,
      });

      const css = emittedCss(fixtureDir);
      assert.ok(
        !css.includes(".bg-blue-500"),
        "emitted CSS contains a .bg-blue-500 rule — the default palette is " +
          "not stripped. Restore `--color-*: initial` in app/globals.css.",
      );
      assert.ok(
        css.includes(".bg-black"),
        "emitted CSS is missing .bg-black — a locked token failed to resolve",
      );
      assert.ok(
        css.includes(".bg-red-600"),
        "emitted CSS is missing .bg-red-600 — a locked token failed to resolve",
      );
    },
  );
});
