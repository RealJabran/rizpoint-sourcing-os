import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

type PasswordHash = { salt: string; digest: string };

function parsePasswordHash(value: string): PasswordHash | null {
  const [scheme, salt, digest] = value.split("$");
  return scheme === "scrypt-v1" && salt && digest ? { salt, digest } : null;
}

/** Versioned salted scrypt. Plaintext is never persisted or logged. */
export async function createPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt-v1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const derived = (await scrypt(
    password,
    Buffer.from(parsed.salt, "base64url"),
    64,
  )) as Buffer;
  const expected = Buffer.from(parsed.digest, "base64url");
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}
