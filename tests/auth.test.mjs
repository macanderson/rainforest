/**
 * Unit tests for the issue #27 auth surface: scrypt password hashing,
 * iron-session seal/unseal round-trip and tamper rejection, the role-aware
 * nav registry, and the seeded demo accounts (architecture.md §5).
 */
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { sealData, unsealData } from "iron-session";

import { hashPassword, verifyPassword } from "../lib/auth/password.ts";
import { navForRole, roleCanAccess } from "../lib/auth/nav.ts";
import { seedUsers } from "../lib/auth/seed-users.mjs";
import { runMigrations } from "../lib/db/migrate.mjs";

const dir = mkdtempSync(join(tmpdir(), "rf-auth-"));
const dbPath = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

describe("password hashing (scrypt)", () => {
  it("round-trips a correct password", () => {
    const hash = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("correct horse battery staple", hash), true);
  });

  it("rejects a wrong password", () => {
    const hash = hashPassword("right");
    assert.equal(verifyPassword("wrong", hash), false);
  });

  it("never stores the plaintext", () => {
    const hash = hashPassword("hunter2");
    assert.equal(hash.includes("hunter2"), false);
    assert.match(hash, /^scrypt:\d+:\d+:\d+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("salts: two hashes of one password differ", () => {
    assert.notEqual(hashPassword("same"), hashPassword("same"));
  });

  it("rejects malformed hashes without throwing", () => {
    assert.equal(verifyPassword("x", "not-a-hash"), false);
    assert.equal(verifyPassword("x", "scrypt:abc:8:1:zz:yy"), false);
    assert.equal(verifyPassword("x", ""), false);
  });
});

describe("iron-session seal/unseal", () => {
  const password = "a-test-seal-password-of-at-least-32-chars";

  it("round-trips the session payload", async () => {
    const user = {
      id: 1,
      email: "admin@rainforest.dev",
      displayName: "Ada Admin",
      role: "admin",
    };
    const sealed = await sealData({ user }, { password, ttl: 60 });
    const unsealed = await unsealData(sealed, { password, ttl: 60 });
    assert.deepEqual(unsealed.user, user);
  });

  it("rejects a tampered cookie", async () => {
    const sealed = await sealData(
      { user: { id: 1, role: "admin" } },
      { password, ttl: 60 },
    );
    const tampered = sealed.slice(0, -4) + "AAAA";
    // iron-session v9 resolves with an empty object on failure rather than
    // throwing — either way, the tampered payload must not come back.
    const result = await unsealData(tampered, { password, ttl: 60 }).catch(
      () => null,
    );
    assert.equal(result?.user, undefined);
  });

  it("rejects a cookie sealed with a different password", async () => {
    const sealed = await sealData({ user: { id: 1 } }, { password, ttl: 60 });
    const result = await unsealData(sealed, {
      password: "a-different-seal-password-of-32-chars!",
      ttl: 60,
    }).catch(() => null);
    assert.equal(result?.user, undefined);
  });
});

describe("role-aware nav (architecture.md §5)", () => {
  it("admin sees the ops surfaces", () => {
    const hrefs = navForRole("admin").map((e) => e.href);
    assert.deepEqual(hrefs, ["/", "/jobs"]);
  });

  it("sales-rep does not see the jobs surface", () => {
    const hrefs = navForRole("sales-rep").map((e) => e.href);
    assert.deepEqual(hrefs, ["/"]);
  });

  it("agent sees only the overview", () => {
    const hrefs = navForRole("agent").map((e) => e.href);
    assert.deepEqual(hrefs, ["/"]);
  });

  it("every nav entry names at least one permitted role", () => {
    for (const role of ["admin", "sales-rep", "agent"]) {
      for (const entry of navForRole(role)) {
        assert.ok(entry.roles.includes(role));
      }
    }
  });
});

describe("server-side route gating (roleCanAccess)", () => {
  it("admin may access the jobs route and its children", () => {
    assert.equal(roleCanAccess("admin", "/jobs"), true);
    assert.equal(roleCanAccess("admin", "/jobs/clock-shift"), true);
  });

  it("sales-rep and agent may not access the jobs route", () => {
    assert.equal(roleCanAccess("sales-rep", "/jobs"), false);
    assert.equal(roleCanAccess("agent", "/jobs"), false);
  });

  it("every role may access the overview", () => {
    for (const role of ["admin", "sales-rep", "agent"]) {
      assert.equal(roleCanAccess(role, "/"), true);
    }
  });

  it("unregistered routes are authenticated-only (any role passes)", () => {
    for (const role of ["admin", "sales-rep", "agent"]) {
      assert.equal(roleCanAccess(role, "/some-future-screen"), true);
    }
  });

  it("the root gate does not swallow sibling routes", () => {
    // "/" must match exactly, not as a prefix of everything.
    assert.equal(roleCanAccess("sales-rep", "/jobs"), false);
  });
});

describe("seeded demo accounts (issue #27)", () => {
  it("seeds admin and sales-rep accounts that verify against their passwords", () => {
    const inserted = seedUsers(dbPath, {});
    assert.deepEqual(
      inserted.map((a) => a.role).sort(),
      ["admin", "sales-rep"],
    );

    const sqlite = new Database(dbPath);
    const rows = sqlite
      .prepare("SELECT email, role, password_hash, data_origin FROM users")
      .all();
    sqlite.close();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.data_origin, "seed");
      const expected =
        row.role === "admin" ? "admin-demo-password" : "rep-demo-password";
      assert.equal(verifyPassword(expected, row.password_hash), true);
      assert.equal(verifyPassword("not-the-password", row.password_hash), false);
    }
  });

  it("is idempotent — reseeding inserts nothing and preserves rows", () => {
    const again = seedUsers(dbPath, {});
    assert.deepEqual(again, []);
    const sqlite = new Database(dbPath);
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    sqlite.close();
    assert.equal(count, 2);
  });

  it("honours env overrides for email and password", () => {
    const otherPath = join(dir, "override.db");
    seedUsers(otherPath, {
      ADMIN_EMAIL: "ops@example.com",
      ADMIN_PASSWORD: "s3cret-admin",
      SALES_REP_EMAIL: "seller@example.com",
      SALES_REP_PASSWORD: "s3cret-rep",
    });
    const sqlite = new Database(otherPath);
    const rows = sqlite
      .prepare("SELECT email, password_hash FROM users ORDER BY email")
      .all();
    sqlite.close();
    assert.deepEqual(
      rows.map((r) => r.email),
      ["ops@example.com", "seller@example.com"],
    );
    assert.equal(verifyPassword("s3cret-admin", rows[0].password_hash), true);
    assert.equal(verifyPassword("s3cret-rep", rows[1].password_hash), true);
  });

  it("the users table carries the data_origin CHECK constraint", () => {
    runMigrations(dbPath);
    const sqlite = new Database(dbPath);
    assert.throws(() =>
      sqlite
        .prepare(
          "INSERT INTO users (email, display_name, role, password_hash, data_origin) " +
            "VALUES ('x@x.dev', 'X', 'admin', 'h', 'bogus')",
        )
        .run(),
    );
    sqlite.close();
  });
});
