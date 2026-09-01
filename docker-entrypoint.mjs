/**
 * Container entrypoint (issue #15) — applies any pending Drizzle migrations
 * to the SQLite file on the volume mount (prod path
 * /var/lib/rainforest/rainforest.db, architecture.md §7.2), then hands off to
 * the Next.js standalone server via `exec` so node stays PID 1 and receives
 * signals directly. The database file itself is never baked into the image;
 * it is created on first boot on the mounted volume.
 */
import { runMigrations } from "./lib/db/migrate.mjs";

const dbPath = process.env.DATABASE_PATH ?? "/var/lib/rainforest/rainforest.db";
const applied = runMigrations(dbPath);
console.log(
  applied.length > 0
    ? `[entrypoint] applied ${applied.length} migration(s) to ${dbPath}: ${applied.join(", ")}`
    : `[entrypoint] database at ${dbPath} is up to date`,
);

const { spawnSync } = await import("node:child_process");
const result = spawnSync("node", ["server.js"], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 0);
}
