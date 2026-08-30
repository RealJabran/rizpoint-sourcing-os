#!/usr/bin/env node
import { createPublicKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

const attestationPath = argument("attestation");
const privateKeyPath = argument("private-key");
const signaturePath = argument("signature-out");
const publicKeyPath = argument("public-key-out");
if (!attestationPath || !privateKeyPath || !signaturePath || !publicKeyPath)
  throw new Error(
    "Usage: --attestation=<json> --private-key=<ed25519-pem> --signature-out=<file> --public-key-out=<file>",
  );

const [bytes, privateKey] = await Promise.all([
  readFile(attestationPath),
  readFile(privateKeyPath, "utf8"),
]);
const parsed = JSON.parse(bytes.toString("utf8"));
if (parsed.schemaVersion !== 2 || typeof parsed.deploymentId !== "string")
  throw new Error("Attestation must use schemaVersion 2 and a deploymentId.");
if (
  !parsed.controls ||
  Object.values(parsed.controls).some((value) => value.status !== "VERIFIED")
)
  throw new Error(
    "Refusing to sign an attestation with an unverified control.",
  );

const signature = sign(null, bytes, privateKey).toString("base64") + "\n";
const publicKey = createPublicKey(privateKey).export({
  type: "spki",
  format: "pem",
});
await writeFile(signaturePath, signature, { mode: 0o600, flag: "wx" });
await writeFile(publicKeyPath, publicKey, { mode: 0o644, flag: "wx" });
process.stdout.write(
  "Signed the exact attestation bytes; retain the private key outside Git.\n",
);
