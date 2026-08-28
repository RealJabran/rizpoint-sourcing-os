import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function generateTotpSecret(bytes = 20): string {
  return encodeBase32(randomBytes(bytes));
}

export function encodeBase32(input: Buffer): string {
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, "0");
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

export function decodeBase32(value: string): Buffer {
  const clean = value.toUpperCase().replace(/=+$/u, "").replace(/\s+/gu, "");
  if (!clean || [...clean].some((char) => !BASE32_ALPHABET.includes(char)))
    throw new Error("TOTP_SECRET_INVALID");
  let bits = "";
  for (const char of clean)
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, at = new Date()): string {
  const counter = Math.floor(at.getTime() / 1_000 / TOTP_PERIOD_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function verifyTotpCode(
  secret: string,
  supplied: string,
  at = new Date(),
): boolean {
  if (!/^\d{6}$/u.test(supplied)) return false;
  const suppliedBuffer = Buffer.from(supplied);
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(
      totpCode(
        secret,
        new Date(at.getTime() + offset * TOTP_PERIOD_SECONDS * 1_000),
      ),
    );
    if (
      expected.length === suppliedBuffer.length &&
      timingSafeEqual(expected, suppliedBuffer)
    )
      return true;
  }
  return false;
}

export function totpEnrollmentUri(input: {
  secret: string;
  email: string;
  issuer?: string;
}): string {
  const issuer = input.issuer ?? "RizPoint";
  const label = encodeURIComponent(`${issuer}:${input.email}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
