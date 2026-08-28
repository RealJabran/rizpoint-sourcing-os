import { CredentialVault } from "@rizpoint/amazon-sp-api";

export function mfaVaultFromEnvironment(): CredentialVault {
  const encoded = process.env.MFA_CREDENTIAL_KEY_V1;
  if (!encoded) throw new Error("MFA_CREDENTIAL_KEY_NOT_CONFIGURED");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("MFA_CREDENTIAL_KEY_INVALID");
  return new CredentialVault(new Map([[1, key]]), 1);
}
