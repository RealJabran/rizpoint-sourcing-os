import {
  createHash,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  constants,
} from "node:crypto";
import type { SpApiRegion } from "./connectivity.js";

type Environment = Readonly<Record<string, string | undefined>>;

export const AMAZON_SELLER_CENTRAL_URLS: Readonly<Record<string, string>> = {
  ATVPDKIKX0DER: "https://sellercentral.amazon.com",
  A2EUQ1WTGCTBG2: "https://sellercentral.amazon.ca",
  A1F83G8C2ARO7P: "https://sellercentral-europe.amazon.com",
  A1PA6795UKMFR9: "https://sellercentral-europe.amazon.com",
};

export const AMAZON_MARKETPLACE_REGIONS: Readonly<Record<string, SpApiRegion>> =
  {
    ATVPDKIKX0DER: "NA",
    A2EUQ1WTGCTBG2: "NA",
    A1F83G8C2ARO7P: "EU",
    A1PA6795UKMFR9: "EU",
  };

export type AmazonOAuthPublicConfiguration = {
  applicationId: string;
  redirectUri: string;
  callbackPublicKey: string;
  callbackKeyVersion: number;
  draft: boolean;
};

function configured(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value || value.startsWith("replace-with-"))
    throw new Error("OAUTH_NOT_CONFIGURED");
  return value.replace(/\\n/g, "\n");
}

export function readAmazonOAuthPublicConfiguration(
  environment: Environment = process.env,
): AmazonOAuthPublicConfiguration {
  if (environment.SP_API_OAUTH_ENABLED !== "true")
    throw new Error("OAUTH_NOT_CONFIGURED");
  const keyVersion = Number(
    environment.SP_API_OAUTH_CALLBACK_KEY_VERSION ?? "1",
  );
  if (!Number.isInteger(keyVersion) || keyVersion < 1)
    throw new Error("OAUTH_NOT_CONFIGURED");
  const redirectUri = configured(environment, "SP_API_OAUTH_REDIRECT_URI");
  const parsed = new URL(redirectUri);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost")
    throw new Error("OAUTH_NOT_CONFIGURED");
  return {
    applicationId: configured(environment, "SP_API_APPLICATION_ID"),
    redirectUri,
    callbackPublicKey: configured(
      environment,
      "SP_API_OAUTH_CALLBACK_PUBLIC_KEY",
    ),
    callbackKeyVersion: keyVersion,
    draft: environment.SP_API_OAUTH_DRAFT === "true",
  };
}

export function amazonOAuthPublicConfigurationAvailable(
  environment: Environment = process.env,
): boolean {
  try {
    readAmazonOAuthPublicConfiguration(environment);
    return true;
  } catch {
    return false;
  }
}

export function createAuthorizationState(): {
  state: string;
  stateHash: string;
} {
  const state = randomBytes(32).toString("base64url");
  return { state, stateHash: hashAuthorizationState(state) };
}

export function hashAuthorizationState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function buildAmazonAuthorizationUrl(input: {
  sellerCentralUrl: string;
  applicationId: string;
  state: string;
  draft: boolean;
}): string {
  const url = new URL("/apps/authorize/consent", input.sellerCentralUrl);
  url.searchParams.set("application_id", input.applicationId);
  url.searchParams.set("state", input.state);
  if (input.draft) url.searchParams.set("version", "beta");
  return url.toString();
}

export function buildAmazonAuthorizationConfirmationUrl(input: {
  amazonCallbackUri: string;
  amazonState: string;
  state: string;
  redirectUri: string;
  draft: boolean;
}): string {
  const url = new URL(input.amazonCallbackUri);
  const allowedHosts = new Set([
    "amazon.com",
    "sellercentral.amazon.com",
    "sellercentral.amazon.ca",
    "sellercentral-europe.amazon.com",
  ]);
  if (
    url.protocol !== "https:" ||
    !allowedHosts.has(url.hostname) ||
    !url.pathname.startsWith("/apps/authorize/confirm/")
  )
    throw new Error("AMAZON_CALLBACK_URI_INVALID");
  url.search = "";
  url.hash = "";
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("amazon_state", input.amazonState);
  url.searchParams.set("state", input.state);
  if (input.draft) url.searchParams.set("version", "beta");
  return url.toString();
}

export function encryptAuthorizationCode(
  authorizationCode: string,
  publicKey: string,
): string {
  return publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(authorizationCode, "utf8"),
  ).toString("base64url");
}

export function decryptAuthorizationCode(
  encryptedAuthorizationCode: string,
  privateKey: string,
): string {
  return privateDecrypt(
    {
      key: privateKey.replace(/\\n/g, "\n"),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(encryptedAuthorizationCode, "base64url"),
  ).toString("utf8");
}
