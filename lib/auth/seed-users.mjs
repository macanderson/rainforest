/**
 * Seed the demo credential accounts (architecture.md §5, issue #27 —
 * "Seeded demo accounts exist for the roles that log in interactively").
 *
 * Idempotent: an account whose email already exists is left untouched, so
 * reseeding never clobbers a changed password. Passwords come from env vars
 * with documented dev defaults — the demo box is a fiction, not a vault.
 *
 *   ADMIN_EMAIL / ADMIN_PASSWORD           (default admin@rainforest.dev / admin-demo-password)
 *   SALES_REP_EMAIL / SALES_REP_PASSWORD   (default rep@rainforest.dev / rep-demo-password)
 *
 * The `agent` role never logs in interactively (agents authenticate via
 * bearer secret on the cron endpoints), so no interactive agent account is
 * seeded.
 *
 * Usage: node lib/auth/seed-users.mjs   (DATABASE_PATH=... to override)
 */
import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { hashPassword } from "./password.ts";
import { runMigrations } from "../db/migrate.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const DEMO_ACCOUNTS = [
  {
    envPrefix: "ADMIN",
    email: "admin@rainforest.dev",
    password: "admin-demo-password",
    displayName: "Ada Admin",
    role: "admin",
  },
  {
    envPrefix: "SALES_REP",
    email: "rep@rainforest.dev",
    password: "rep-demo-password",
    displayName: "Sam Sales",
    role: "sales-rep",
  },
];

export function seedUsers(dbPath, env = process.env) {
  runMigrations(dbPath);
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  const inserted = [];
  try {
    const exists = sqlite.prepare("SELECT 1 FROM users WHERE email = ?");
    const insert = sqlite.prepare(
      "INSERT INTO users (email, display_name, role, password_hash, data_origin) " +
        "VALUES (?, ?, ?, ?, 'seed')",
    );
    for (const account of DEMO_ACCOUNTS) {
      const email = env[`${account.envPrefix}_EMAIL`] ?? account.email;
      const password =
        env[`${account.envPrefix}_PASSWORD`] ?? account.password;
      if (exists.get(email)) continue;
      insert.run(email, account.displayName, account.role, hashPassword(password));
      inserted.push({ email, role: account.role });
    }
  } finally {
    sqlite.close();
  }
  return inserted;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dbPath = process.env.DATABASE_PATH ?? join(REPO_ROOT, "data/rainforest.db");
  const inserted = seedUsers(dbPath);
  console.log(
    inserted.length > 0
      ? `Seeded ${inserted.length} demo account(s): ${inserted.map((a) => `${a.email} (${a.role})`).join(", ")}`
      : "Demo accounts already present — nothing to seed",
  );
}
