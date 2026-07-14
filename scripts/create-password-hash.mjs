import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

if (process.argv.length > 2)
  throw new Error(
    "Pass the password on standard input, never as a command-line argument.",
  );
const password = (await readFile(0, "utf8")).replace(/\r?\n$/, "");
if (!password || password.length < 14) {
  throw new Error(
    "Pass a password of at least 14 characters on standard input.",
  );
}
const scrypt = promisify(scryptCallback);
const salt = randomBytes(16);
const digest = await scrypt(password, salt, 64);
process.stdout.write(
  `scrypt-v1$${salt.toString("base64url")}$${Buffer.from(digest).toString("base64url")}\n`,
);
