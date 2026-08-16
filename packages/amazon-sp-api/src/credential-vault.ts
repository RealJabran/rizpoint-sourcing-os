import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  ciphertext: string;
  nonce: string;
  tag: string;
  keyVersion: number;
};

export class CredentialVault {
  constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    private readonly activeKeyVersion: number,
  ) {}

  encrypt(value: string, aad: string): EncryptedSecret {
    const key = this.keys.get(this.activeKeyVersion);
    if (!key || key.length !== 32)
      throw new Error("credential_encryption_key_missing");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString("base64url"),
      nonce: nonce.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      keyVersion: this.activeKeyVersion,
    };
  }

  decrypt(value: EncryptedSecret, aad: string): string {
    const key = this.keys.get(value.keyVersion);
    if (!key || key.length !== 32)
      throw new Error("credential_encryption_key_unavailable");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(value.nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export function vaultFromEnvironment(): CredentialVault | null {
  const encoded = process.env.PROVIDER_CREDENTIAL_KEY_V1;
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 32 ? new CredentialVault(new Map([[1, key]]), 1) : null;
}
