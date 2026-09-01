/**
 * Container entrypoint (issue #15) — applies any pending Drizzle migrations
 * to the SQLite file on the volume mount (prod path
 * /var/lib/rainforest/rainforest.db, architecture.md §7.2), then hands off to
 * the Next.js standalone server via `exec` so node stays PID 1 and receives
 * signals directly. The database file itself is never baked into the image;
 * it is created on first boot on the mounted volume.
 */
import { runMigrations } from "./lib/db/migrate.mjs";
import { seedUsers } from "./lib/auth/seed-users.mjs";

const dbPath = process.env.DATABASE_PATH ?? "/var/lib/rainforest/rainforest.db";
const applied = runMigrations(dbPath);
console.log(
  applied.length > 0
    ? `[entrypoint] applied ${applied.length} migration(s) to ${dbPath}: ${applied.join(", ")}`
    : `[entrypoint] database at ${dbPath} is up to date`,
);

// Seed the §5 demo credential accounts (idempotent — existing accounts are
// never clobbered). Passwords come from ADMIN_PASSWORD / SALES_REP_PASSWORD
// with the documented dev defaults.
const seeded = seedUsers(dbPath);
console.log(
  seeded.length > 0
    ? `[entrypoint] seeded ${seeded.length} demo account(s): ${seeded.map((a) => `${a.email} (${a.role})`).join(", ")}`
    : "[entrypoint] demo accounts already present",
);

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.warn(
    "[entrypoint] WARNING: SESSION_SECRET is unset or shorter than 32 characters — " +
      "iron-session will refuse to run in production (architecture.md §5)",
  );
}

const { spawnSync } = await import("node:child_process");
const result = spawnSync("node", ["server.js"], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 0);
}
