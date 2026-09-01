/**
 * Password hashing — scrypt via node:crypto (architecture.md §5: credential
 * auth, email + password). No external dependency; scrypt is the OWASP-
 * recommended KDF available in the Node standard library.
 *
 * Hash format: `scrypt:N:r:p:saltHex:keyHex`. The parameters ride along in
 * the string so a future cost bump rehashes on next login without a
 * migration. Verification is constant-time.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

const PREFIX = "scrypt";

/** Hash a plaintext password for storage. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return [PREFIX, N, R, P, salt.toString("hex"), key.toString("hex")].join(
    ":",
  );
}

/**
 * Verify a plaintext password against a stored hash. Returns false for
 * malformed hashes — never throws, so the login path can treat every
 * failure identically (no oracle between "no such user" and "bad hash").
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const [, nStr, rStr, pStr, saltHex, keyHex] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex ?? "", "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LEN) return false;
  const actual = scryptSync(password, Buffer.from(saltHex ?? "", "hex"), KEY_LEN, {
    N: n,
    r,
    p,
  });
  return timingSafeEqual(actual, expected);
}
